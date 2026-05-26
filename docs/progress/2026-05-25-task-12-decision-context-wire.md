# Task 12: 决策查询接入 get_decision_context — 进度记录

## 目标

在 SearchPalette 加"决策模式"切换，开启后并行调用 `POST /api/mcp/tool/get_decision_context`，结果以独立分组显示在最上方。

## 改动清单

### `desktop-daemon/src/hooks/useSearchMemory.ts`
- 新增类型：`CompactEntity`、`DecisionContext`、`SearchMode`
- `SearchResults` 增加 `decisionContext?` 和 `decisionContextError?`
- `useSearchMemory(searchMode)` 接受模式参数
- 决策模式时，并行 `Promise.all` 中追加 `get_decision_context` 调用（荷载 `{ arguments: { situation: query, limit } }`）
- 决策上下文失败不影响常规结果（全部用 `Promise.allSettled`）

### `desktop-daemon/src/components/SearchPalette.tsx`
- `FlattenedItem.type` 扩展：`"principle" | "history" | "conflict" | ...`
- 新增 `searchMode` state，从 `localStorage('omni_search_mode')` 初始化
- 输入框右侧新增 `Compass` 切换按钮（决策模式 cyan 高亮）
- `flattenedItems`：决策模式时把 `decisionContext` 三类（principles/history/conflicts）各取 3 条拼在最前面
- 新类型独立图标：`BookOpen`(紫)、`History`(蓝)、`ShieldAlert`(红)
- 决策上下文失败时顶部显示错误提示
- query < 5 字符时显示"请描述具体情境"引导提示
- `handleSelect`：决策类型点击跳转到对应实体

### `desktop-daemon/src/locales/zh.ts` + `en.ts`
- 新增：`search.section_principles`、`search.section_history`、`search.section_conflicts`
- 新增：`search.mode_decision`、`search.mode_normal`、`search.decision_hint_short`

## 关键取舍

| 决策 | 理由 |
|------|------|
| `searchMode` 用 ref + localStorage | 避免搜索时切换模式导致 effect 重新触发（ref 不引起重新执行）；localStorage 持久化用户体验记忆 |
| 决策上下文失败用 `allSettled` | 不打断普通搜索结果展示，仅顶部提示 |
| 决策上下文每类只取 3 条 | 浮层空间有限，避免决策结果挤占实体/记忆搜索 |
| query < 5 字不调 decision 时有 hint | 后端对短 query 返回空，引导用户写具体情境 |

## 自测结果

- `npm run build`: 通过

## 遗留问题

- 无
