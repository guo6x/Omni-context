# Task 11: triggerReset 实装真功能 — 进度记录

## 目标

让"重置"按钮/快捷键真正做事：清空会话级 UI 状态（搜索、选中节点、日志、HUD），不动数据库/图谱。

## 改动清单

### `desktop-daemon/src/hooks/useOmniContext.ts`
- `triggerReset` 改为 async，返回 `{ ok: true }`
- 清空日志只保留前 3 条系统启动基线 + 追加 1 条"会话已重置"
- 不再依赖 `addLog`，直接用 `setLogs`

### `desktop-daemon/src/app/page.tsx`
- 重写 `handleReset`：
  - 清除 `focusEntityId`（取消选中节点）
  - 关闭搜索浮层（`setShowSearchPalette(false)`）
  - `await triggerReset()` 清日志
  - HUD 显示"已重置当前会话"（绿色），1.5s 后强制隐藏（不论 autoHUD 设置）
  - 删除 `setTimeout(800)` 写死假动画

### `desktop-daemon/src/locales/zh.ts` + `en.ts`
- 新增 `hud.reset_done`："已重置当前会话" / "Session reset"

## 关键取舍

| 决策 | 理由 |
|------|------|
| reset 后永远 1.5s 隐藏 HUD | 与沉淀不同——重置不涉及异步后端，瞬间完成，HUD 纯告知，不必等用户手动关 |
| 保留前 3 条基线日志 | 给用户一个上下文锚点而非空白控制台 |
| 不做"清空所有数据" | 不可逆操作需要独立 task + 二次确认 |

## 自测结果

- `npm run build`: 通过

## 遗留问题

- "清空所有数据"（数据库级 reset）是另一个独立 task，需要二次确认 UI
