# Task 22 Progress: 决策模式重构为独立"决策助手"页面 + Ctrl+Shift+K

日期: 2026-05-26

## 变更摘要

### 新建文件

**`desktop-daemon/src/hooks/useDecisionContext.ts`**
- 独立的 decision context hook，入参 query 字符串
- 输出: `{ isLoading, error, result, submit(query) }`
- 直接 POST `/api/mcp/tool/get_decision_context`，不做 debounce
- 提交后清掉旧结果再开始，避免新旧混淆

**`desktop-daemon/src/components/DecisionAssistant.tsx`**
- 全屏 modal 覆盖层（非 page 路由），深色半透明背景
- 顶部标题栏 + × 关闭按钮
- 5 行 textarea 自动聚焦，`Ctrl+Enter` 提交，Esc 关闭
- 三列结果区: 适用原则 / 相关历史 / 潜在冲突，每列独立 scrollable
- 每列 header 显示 icon + 分类名 + 计数
- 提交后显示 "AI 正在分析..." spinner
- 结果条目可点击 → 跳转主图谱聚焦实体并关闭决策助手
- 接口失败显示友好错误信息
- 沿用 glass-panel + cyan 强调色风格

### 修改文件

**`desktop-daemon/src/hooks/useSearchMemory.ts`** (~40 行删除)
- 移除 `SearchMode` 类型
- 移除 `searchMode` 参数
- 移除 `DecisionContext` 接口
- 移除 `searchModeRef`
- 移除 `isDecision` 判断和 `decisionPromise` 逻辑
- 移除 `decisionContext` 和 `decisionContextError` 从 `SearchResults`
- 恢复为简单的并发三路搜索 (entities / archival / core)

**`desktop-daemon/src/components/SearchPalette.tsx`** (~80 行删除)
- 移除 `searchMode` state 及 localStorage 持久化
- 移除 Compass toggle 按钮
- 移除 `searchMode === 'decision'` 相关分支
- `flattenedItems` 只保留 entity / archival / core 三种类型
- 移除 principle / history / conflict 类型及对应图标/徽章渲染
- 移除决策提示 UI (decision_hint_short)
- 移除 `handleSelect` 中 decision 类型的处理
- 导入精简：移除 Compass, Lightbulb, BookOpen, History, ShieldAlert

**`desktop-daemon/src/app/page.tsx`**
- 新增 `showDecisionAssistant` state
- 新增 `Ctrl+Shift+K` 快捷键注册 (openDecisionAssistant)
- Header 区新增 Scale 图标按钮 "决策助手"
- `handleDecision` 改为打开 DecisionAssistant
- 挂载 `<DecisionAssistant />` 组件
- 打开决策助手时自动关闭 SearchPalette（两个浮层互斥）

**`desktop-daemon/src/hooks/useKeyboardShortcuts.ts`**
- defaultShortcuts 增加 Ctrl+Shift+K 条目

**`desktop-daemon/src/locales/zh.ts`** + **`desktop-daemon/src/locales/en.ts`**
- 删除: `search.mode_decision`, `search.mode_normal`, `search.decision_hint_short`
- 新增 `decision.*` 键组: title, placeholder, submit, submit_hint, section_principles/history/conflicts, analyzing, no_result_*
- 新增 `header.open_decision_assistant`
- 新增 `shortcuts.decision_assistant_desc`

## 验收自测

| # | 验收标准 | 状态 |
|---|---------|------|
| 1 | `Ctrl+Shift+K` → 决策助手浮层全屏覆盖 | ✅ 已实现 |
| 2 | 自动聚焦输入框，placeholder 引导性文案 | ✅ 已实现 |
| 3 | 输入 + Ctrl+Enter → 分析中 → 三列结果 | ✅ 已实现 |
| 4 | 三列各自可滚动，header 显示计数 | ✅ 已实现 |
| 5 | 点结果项目 → 关闭 + 图谱聚焦 | ✅ 已实现 |
| 6 | Esc / × 关闭 | ✅ 已实现 |
| 7 | Header 区有决策助手独立按钮 | ✅ 已实现 |
| 8 | SearchPalette 不再有 Compass toggle | ✅ 已实现 |
| 9 | SearchPalette 结果只有 entity/archival/core | ✅ 已实现 |
| 10 | API 失败 → 友好错误不 crash | ✅ 已实现 |
| 11 | 中英 i18n 都对 | ✅ 已实现 |
| 12 | `npm run build` 通过 | ✅ 已通过 |

## 约束遵守

- 后端接口不变: 继续用 `POST /api/mcp/tool/get_decision_context`
- 未做成 Next.js 独立 route: modal 覆盖层
- 主窗口图谱画布不 unmount: 声明式 `isOpen` prop 控制
- 提交后清旧结果: useDecisionContext 中 `setResult(null)` 再 fetch
- Ctrl+Shift+K 走 useKeyboardShortcuts 统一管理
- SearchPalette 决策代码彻底删除，无死代码
- 没有额外的 "保存决策" / 多轮交互 / 决策模板 功能
- 决策助手和 SearchPalette 互斥
- 独立组件独立样式，仅共享 glass-panel 基类

## 遗留问题

- 无
