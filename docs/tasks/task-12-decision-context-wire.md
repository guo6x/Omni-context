# Task 12: 决策查询接入 get_decision_context（P1）

## 背景

后端 [brain-server/src/mcp-tools.ts:324-336](D:\AI_code\Omni-context\omni-context-release\brain-server\src\mcp-tools.ts) 已实现 `get_decision_context` MCP 工具：根据用户描述的情境，返回相关原则、历史记忆和冲突，对应 HTTP 端点 `POST /api/mcp/tool/get_decision_context`。

但前端 `handleDecision`（page.tsx:390-393）现在只是打开了 SearchPalette。SearchPalette 只查实体 / archival / core，**没有调 decision_context**。

## 目标

在 SearchPalette 浮层里加一个"决策模式"开关 / 按钮，开启后查询会额外调用 `get_decision_context`，结果作为独立分组展示在最上方。

成功标准：

1. SearchPalette 浮层右上角有一个"决策模式 / 普通搜索"切换按钮（toggle icon + 文字）
2. 决策模式开启 + 输入查询 → 除了三个原有 search API，并行调用 `POST /api/mcp/tool/get_decision_context`，载荷 `{ arguments: { situation: query } }`
3. 返回结果包含 `applicable_principles`（适用原则）/ `relevant_history`（历史记忆）/ `potential_conflicts`（潜在冲突）三类
4. 这些结果以独立的"决策上下文"分组显示在浮层最上方，每类各显示 3 条
5. 普通模式 → 只调原来的三个 search API，UI 跟现在一致
6. 决策模式状态用 localStorage 持久化（用户上次选的模式下次还在）

## 涉及文件

- `desktop-daemon/src/hooks/useSearchMemory.ts`
  - 入参加 `mode: 'normal' | 'decision'`
  - decision 模式时**额外** Promise.all 一个 `/api/mcp/tool/get_decision_context` 调用
  - 返回结构里增加 `decisionContext?: { applicable_principles, relevant_history, potential_conflicts }`
- `desktop-daemon/src/components/SearchPalette.tsx`
  - input 右侧加 toggle 按钮（lucide `Compass` 或 `Lightbulb` icon，cyan 强调色高亮表示决策模式）
  - state 用 `searchMode: 'normal' | 'decision'`
  - flattenedItems 改造：决策模式时把 `decisionContext` 三类展开拼在最前面，类型扩展为 `'principle' | 'history' | 'conflict' | 'entity' | 'archival' | 'core'`
  - 每类的图标 / 颜色要明显区分（principles 紫色、history 蓝色、conflicts 红色，entity/archival/core 沿用现有）
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 加：`search.mode_decision`、`search.mode_normal`、`search.section_principles`、`search.section_history`、`search.section_conflicts`

## 约束

- **不要把决策模式做成默认模式**——普通搜索的频率远高于决策查询
- decision_context 接口可能在 query 很短（<5 字）时返回空，需要给 UI 一个"请描述具体情境（如：在做技术选型时如何…）"的提示
- 决策模式调用失败时**不要打断普通搜索结果展示**——Promise.allSettled
- 不要改 brain-server 后端（接口已就绪）
- 持久化用 localStorage key `omni_search_mode`，默认 `'normal'`

## 验收标准

1. ✅ 浮层右上角能看到"决策模式"切换按钮
2. ✅ 普通模式输入 → 三类（entity / archival / core）结果展示
3. ✅ 决策模式输入"在选 React 状态管理库时" → 浮层最上方出现"适用原则 / 相关历史 / 潜在冲突"三组（数据有的话）
4. ✅ 决策模式下 decision_context 失败 → 普通三类结果仍正常显示，顶部提示一句"决策上下文加载失败"
5. ✅ 切换模式后关闭浮层再次打开 → 上次模式保留
6. ✅ `npm run build` 通过

## 进度文档

`docs/progress/2026-05-25-task-12-decision-context-wire.md`

## 不要做的事

- 不要做"决策推荐"AI 助手——本任务只是把已有的 backend tool 接入 UI
- 不要顺手改 handlePrecipitate / handleReset
- 不要在 SearchPalette 里塞太多模式（普通 vs 决策两个就够了，未来再加别的就过载）
