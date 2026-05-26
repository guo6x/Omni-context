# Task 10: 沉淀反馈对齐真实后端结果（P0）

## 背景

[desktop-daemon/src/app/page.tsx:361-388](D:\AI_code\Omni-context\omni-context-release\desktop-daemon\src\app\page.tsx) 的 `handlePrecipitate`：

```ts
const handlePrecipitate = async () => {
  ...
  triggerPrecipitate();                          // ← 没 await！
  setTimeout(() => {
    pushFloatingHUD("success", done);            // ← 1.5 秒后必定显示"成功"
    if (autoHUD) setTimeout(hide, 2000);
  }, 1500);
};
```

而 `triggerPrecipitate()`（useOmniContext.ts:60-91）走的是 `POST /api/graph/extract`，加上 OCR + LLM 抽取，真实耗时往往 5-30 秒。

**结果**：HUD 在固定 1.5s 后显示"成功"，但后端可能还在跑、可能已经失败、可能返回了 0 实体。用户看到"成功"跟实际结果完全脱钩。

## 目标

让"沉淀"的反馈忠实于后端结果。

成功标准：

1. 点沉淀 / 按快捷键 → HUD 进入"处理中"状态 + spinner 持续显示
2. 后端成功返回 → HUD 显示"沉淀成功 · N 实体 / M 关系"（带数字），不再是无信息的"成功"
3. 后端失败（HTTP 错误 / fetch reject）→ HUD 显示"沉淀失败：<原因摘要>"，红色样式
4. 后端返回 0 实体 → 不要假装成功，显示"未抽取到新内容（可能 LLM 未配置 / 内容太少）"
5. HUD 不再以固定 1.5s 切换状态，由后端 await 完成驱动

## 涉及文件

- `desktop-daemon/src/hooks/useOmniContext.ts`
  - 修改 `triggerPrecipitate` 返回 `Promise<{ ok: boolean; entities?: number; relationships?: number; error?: string }>`
  - 原来 try/catch 内部 addLog，现在补一份 return：成功 return `{ ok: true, entities: result.entities, relationships: result.relationships }`，失败 return `{ ok: false, error: String(error) }`
  - 注意：原来 catch 已经 addLog 报错，return 之后调用方不需要再 toast 报错重复——但 HUD 显示是需要的
- `desktop-daemon/src/app/page.tsx`
  - 改 `handlePrecipitate`：
    - 设置 HUD "processing" 状态后立刻显示
    - `const result = await triggerPrecipitate();`
    - 根据 result：
      - `result.ok && result.entities > 0` → HUD "success" + "沉淀成功 · X 实体 / Y 关系"
      - `result.ok && result.entities === 0` → HUD "warning" + "未抽取到新内容"
      - `!result.ok` → HUD "error" + 错误摘要（截断到 80 字符）
    - 删除 `setTimeout(..., 1500)` 那段写死的逻辑
    - 保留 `autoHUD` 自动隐藏：2s 后隐藏 HUD（如果用户开了 autoHUD）
- `desktop-daemon/src/components/HUD.tsx` / `FloatingHUD.tsx`
  - 确认支持 "warning" / "error" 状态（status 类型可能要扩展）
  - 如果只支持 'processing' | 'success'，需要加 'warning' | 'error' 颜色样式
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加 `hud.precipitate_no_content`、`hud.precipitate_failed`

## 约束

- **不要改 `/api/graph/extract` 返回结构**——已经是 `{ entities, relationships, principles }`，前端利用即可
- **不要把 HUD 改成 modal**——保持非阻塞悬浮
- 错误信息**不要原样塞**进 HUD（可能很长 stack），先截断 80 字符 + 详细错误进 console
- 沉淀过程中如果用户**再次按沉淀快捷键**，应该提示"正在沉淀中"而不是再开一次（用一个 `isPrecipitating` ref 防重）
- `handleReset`（page.tsx:408 附近）有同样的"1.5s 写死成功"问题——本任务**只修 precipitate**，reset 留给 [[task-11-trigger-reset-impl]]
- 不要破坏现有 autoHUD 设置

## 验收标准

1. ✅ 配好 LLM + 抓一段有意义的截图 / 剪贴板 → 沉淀 → HUD 显示"沉淀成功 · 3 实体 / 2 关系"或类似具体数字
2. ✅ 没配 LLM → 沉淀 → HUD 显示"未抽取到新内容（可能 LLM 未配置）" 而非假装成功
3. ✅ 故意把 brain-server 关掉 → 沉淀 → HUD 显示红色错误，包含简短原因
4. ✅ 沉淀进行中连按 3 次快捷键 → 只发起一次请求（防重）
5. ✅ autoHUD 关闭时，HUD 不自动消失，让用户能看到结果
6. ✅ `cd desktop-daemon && npm run build` 通过

## 进度文档

`docs/progress/2026-05-25-task-10-precipitate-feedback-align.md`

## 不要做的事

- 不要顺便修 handleReset / handleDecision（那是另两个 task）
- 不要在 HUD 上加按钮（如"查看详情"）——保持只读
