# Task 10: 沉淀反馈对齐真实后端结果 — 进度记录

## 目标

让"沉淀"操作的 HUD 反馈忠实反映 `/api/graph/extract` 的真实结果，而不是固定 1.5s 后假成功。

## 改动清单

### `desktop-daemon/src/hooks/useOmniContext.ts`
- `triggerPrecipitate` 改为返回 `Promise<{ ok: boolean; entities?: number; relationships?: number; error?: string }>`
- 成功时返回实体/关系数量；失败时 return `{ ok: false, error }` 而不只 catch 内 addLog
- 实体/关系数从 response array length 计算而非依赖后端可能错误的 number 类型

### `desktop-daemon/src/app/page.tsx`
- 新增 `isPrecipitating` ref 防重：连续按快捷键只发起一次请求
- 重写 `handlePrecipitate`：
  - 先设 HUD "processing" 状态
  - `await triggerPrecipitate()` 拿到真实结果
  - 有实体 → HUD "success" + 数量
  - 0 实体 → HUD "warning" + "未抽取到新内容"
  - 失败 → HUD "error" + 截断到 80 字符的错误
  - 删除 `setTimeout(..., 1500)` 写死逻辑
  - 保留 autoHUD 自动隐藏（2s）
- `hudStatus` 类型添加 `"warning"`

### `desktop-daemon/src/components/HUD.tsx`
- status 类型添加 `"warning"`
- 新增 `AlertTriangle` 琥珀色图标
- 文字颜色新增 amber-400

### `desktop-daemon/src/components/FloatingHUD.tsx`
- `HudStatus` 类型添加 `"warning"`
- 新增 `AlertTriangle` 图标和 `border-l-amber-400` 边框色

### `desktop-daemon/src/locales/zh.ts` + `en.ts`
- `hud.precipitate_success` 改为带占位符模板
- 新增 `hud.precipitate_no_content`、`hud.precipitate_failed`、`hud.precipitate_in_progress`

## 关键取舍

| 决策 | 理由 |
|------|------|
| 防重用 ref 而非 state | ref 变更不触发渲染，且 `isPrecipitating` 在 try/catch/finally 外设置，避免 stuck |
| 实体/关系数从 array length 计算 | 避免依赖可能错误的 API 返回格式 |
| 错误截断 80 字符 | HUD 空间有限，详细错误可通过 console/log 查看 |
| autoHUD 只在完成时自动关闭 | 不管成功失败都 2s 后关（跟原来行为一致） |

## 自测结果

- `npm run build`: 通过

## 遗留问题

- `handleReset` 有相同的固定超时问题，留给 task-11
