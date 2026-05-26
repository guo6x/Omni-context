# Task 09: 把截图接入 OCR 再喂给 LLM（P0，产品最大功能 bug）

## 背景

排查发现：产品最核心的"按快捷键沉淀屏幕知识"功能**实际上等于没做**。

证据：[brain-server/src/graphrag/extractor.ts:376-392](D:\AI_code\Omni-context\omni-context-release\brain-server\src\graphrag\extractor.ts) 的 `combineInputs()` 把传进来的 screenshot base64 处理成：

```ts
if (input.screenshot) {
  parts.push(`[Screenshot available]`);   // ← 只加了一个字面量标记！
}
```

也就是说：

1. 用户按快捷键 → 桌面 App 截屏 → base64 通过 fetch 传到 `/api/graph/extract`
2. brain-server 收到 base64 → 进 combineInputs → 只在文本里塞了一句 "[Screenshot available]"
3. LLM 看到 "[Screenshot available]" + 剪贴板内容 → 抽出来的实体几乎都跟截图无关
4. **截图 base64 数据被完全丢弃**

而 brain-server 已经有完整的 OCR 能力（`brain-server/src/ocr/pipeline.ts`），在文件上传流程（`ingest.ts:211-219`）里被正确使用了，但 extract 流程没调。

## 目标

让"沉淀"流程真的能从截图里读出文字、并喂给 LLM 抽取图谱。

成功标准：

1. 桌面 App 触发沉淀 → 截屏 → 截图里如果有可识别的文字（中英都行）→ 抽取出来的实体能反映截图内容
2. 截图没文字 / OCR 失败 → 不要 crash，跟"只有剪贴板"的情况降级处理
3. OCR 耗时不能让整个 extract 卡死——超时 10 秒就跳过
4. 用户在设置面板能看到 OCR 引擎状态（已有 settings tab 里就有自检，确认 `OCR 已就绪` 已经在工作）

## 涉及文件

- `brain-server/src/graphrag/extractor.ts`
  - 修改 `combineInputs()` 改为 **async**（注意：调用方 `extract()` 已经是 async，不影响）
  - 当 `input.screenshot` 存在时：
    - 实例化 `OCRPipeline`，调 `extractText(dataUrl)`
    - 把识别出的文字拼到 `parts` 里：`parts.push(\`[Screenshot OCR]\\n${text}\`)`
    - 完成后 `await ocr.dispose()` 释放 worker
    - 整个 OCR 调用包 try/catch + 10s AbortController/Promise.race 超时
    - 失败时降级：`parts.push('[Screenshot OCR failed]')`，继续走 LLM 提取
  - **保留 `[Screenshot available]` 兜底**：仅在 OCR 整体失败时使用
- `brain-server/src/graphrag/extractor.ts` 的 `extract()` 函数
  - 由于 `combineInputs()` 变 async，调用点改成 `const text = await this.combineInputs(input);`
- 不要改 `desktop-daemon` 任何文件——前端发的 payload 已经是对的

## 约束

- **不要做新的 OCR 管线**——复用 `OCRPipeline` 现有实现
- 默认 `engine: 'local'`, `languages: 'eng+chi_sim'`（OCRPipeline 默认就是）
- screenshot 入参格式：`data:image/png;base64,<...>` 或纯 base64 字符串都要支持。pipeline.extractText 接受 dataUrl，需要先 normalize（如果裸 base64，前面拼 `data:image/png;base64,`）
- **OCR 单次成功率不高的情况下，要看得到日志**：`console.log('[Extract] OCR identified N characters from screenshot')`
- **不引入新的依赖**
- 不要为了"通用性"把 OCR 拉出来做成 middleware——目前只有 extract 一处需要补，pipeline 已经被 ingest 用了

## 验收标准

1. ✅ 单元 / 手工测试：构造一张包含明显文字的截图（例如截一段 README）→ 调 `/api/graph/extract` → 返回的实体名 / description 里能看到截图里的关键词
2. ✅ 截图里只有图标 / 无文字 → 抽取不会崩，照常完成（实体可能少 / 0）
3. ✅ OCR 超过 10s → 降级为 `[Screenshot OCR failed]`，整体 extract 仍能返回
4. ✅ `cd brain-server && npx tsc --noEmit` 无错
5. ✅ `cd brain-server && npm run build` 通过

## 进度文档

完成后写到 `docs/progress/2026-05-25-task-09-screenshot-ocr-in-extract.md`，包含：
- 目标 / 改动清单 / 关键取舍（OCR 超时实现 / 错误处理）/ 自测结果 / 遗留问题

## 不要做的事

- 不要顺便重构 GraphRAGExtractor 整体结构
- 不要把 OCR 结果存到 archival memory（那是另一回事）
- 不要把 screenshot base64 自己也存起来——目前流程不存，保持
