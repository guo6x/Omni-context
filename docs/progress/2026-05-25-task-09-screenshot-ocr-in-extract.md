# Task 09: 截图 OCR 接入 extract 流程 — 进度记录

## 目标

让 `GraphRAGExtractor.combineInputs()` 在收到截图 base64 后真正调用 OCR 提取文字，而不是只塞 `[Screenshot available]` 字面量标记。

## 改动清单

- **`brain-server/src/graphrag/extractor.ts`**:
  1. 导入 `OCRPipeline` from `../ocr/pipeline.js`
  2. `combineInputs()` 改为 `async`，返回 `Promise<string>`
  3. screenshot 分支：normalize 入参（裸 base64 → 补 `data:image/png;base64,`），实例化 `OCRPipeline`，`Promise.race` 10s 超时，成功时输出 `[Screenshot OCR]\n{text}` 并 log 字符数，失败/超时时输出 `[Screenshot OCR failed]`
  4. `extract()` 中调用改为 `await this.combineInputs(input)`

## 关键取舍

| 决策 | 理由 |
|------|------|
| OCR 超时用 `Promise.race` + `setTimeout` 而非 `AbortController` | `AbortController` 需要主动 abort 底层 operation，Tesseract worker 的 recognize 方法不直接支持 abort，反而 `Promise.race` 更简单可靠——超时后 worker 在 `finally` 中 dispose，避免资源泄漏 |
| 超时后输出 `[Screenshot OCR failed]` 而非保留 `[Screenshot available]` | 超时也属于 OCR 失败，统一走失败标记 |
| 不缓存 OCRPipeline 实例为类属性 | 每次 extract 调用频率低（用户手动触发），不需要实例缓存复杂度；且每次用完 dispose 避免 worker 占用内存 |

## 自测结果

- `npx tsc --noEmit`: 无错误
- `npm run build`: 通过

## 遗留问题

- 无
