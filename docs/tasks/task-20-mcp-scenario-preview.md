# Task 20: MCP 接入页加"能力预览"场景示例（P3）

## 背景

[desktop-daemon/src/components/SettingsPanel.tsx](D:\AI_code\Omni-context\omni-context-release\desktop-daemon\src\components\SettingsPanel.tsx) 的 MCP 接入页（task-02 加的）目前只告诉用户"怎么接入"，没告诉用户"接入完了能做什么"。

用户的心理模型："我装了这个 MCP，然后呢？在 Claude 里说什么话能触发它？"

`brain-server/src/mcp-tools.ts` 有 14 个工具，每个 description 写得不错（给 AI 看的英文），但没翻译给用户看。

## 目标

在 MCP 接入区块顶部加一个"能力预览"小卡片，展示 3-5 个具体的用户使用场景，让用户秒懂"接入后能干嘛"。

成功标准：

1. MCP 接入页最顶部有一个"接入后你能做什么"区块（折叠展开式，默认展开）
2. 列 5 条具体场景，每条有：场景描述 + 用户在 AI 里说的话示例 + 触发的 MCP 工具名（带 tooltip 解释）
3. 例如：
   - "找历史笔记" — 在 Claude 里说"帮我找一下上次关于 React 架构的笔记" — 调用 `unified_memory_search`
   - "回顾决策原则" — 在 Cursor 里说"在选状态管理库时我之前定过什么原则？" — 调用 `get_decision_context`
   - "录入新知识" — 在 Claude 里说"把这段对话当成结论存进 omni" — 调用 `record_capture`
   - "看看实体之间的关联" — 说"omni 里有哪些跟 GraphRAG 相关的实体？" — 调用 `search_entities` + `get_graph_neighborhood`
   - "知识衰减提醒" — 说"omni 最近有什么衰减预警？" — 调用 `get_decay_report`
4. 每条场景旁边有图标（lucide），布局紧凑

## 涉及文件

- `desktop-daemon/src/lib/mcp-scenarios.ts`（新建）
  - 导出 `MCP_SCENARIOS: Array<{ icon, title, prompt, tool }>`
- `desktop-daemon/src/components/SettingsPanel.tsx`
  - MCP Tab 顶部加这个区块
  - 复用现有 i18n
- `desktop-daemon/src/locales/zh.ts` + `en.ts`
  - 5 条场景的中英文文案

## 约束

- **场景描述要具体到一句话能让用户复制粘贴试**，不要写抽象描述
- 别超过 5 条（多了就过载）
- 工具名展示用 monospace 字体 + tooltip 显示该工具的 schema description（来自 mcp-tools.ts）
- 不要做"实际试用"按钮（用户得在他自己的 AI 客户端里粘贴 prompt）
- 不要破坏现有 MCP 卡片布局

## 验收标准

1. ✅ 打开设置 → MCP 接入页 → 顶部能看到"接入后你能做什么"区块
2. ✅ 5 条场景都能展示完整
3. ✅ tooltip 显示工具说明
4. ✅ 切英文展示英文
5. ✅ `npm run build` 通过

## 进度文档

`docs/progress/2026-05-25-task-20-mcp-scenario-preview.md`

## 不要做的事

- 不要做"在 AI 助手里测试"的内嵌 iframe / 联调按钮
- 不要把 14 个工具全列出来——挑最有用的 5 个场景就行
- 不要顺便改 McpClientCard
