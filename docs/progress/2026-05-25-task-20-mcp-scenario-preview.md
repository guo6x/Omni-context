# Task 20: MCP 接入页加"能力预览"场景示例

**日期:** 2026-05-25
**状态:** 完成

## 改动摘要

在 MCP 接入页顶部新增可折叠"接入后你能做什么"能力预览区块，展示 5 条具体使用场景。

## 改动文件

1. **新建 `desktop-daemon/src/lib/mcp-scenarios.ts`**
   - 定义 `McpScenario` 接口和 `MCP_SCENARIOS` 数组
   - 5 条场景，每条含图标、标题、提示语、工具名和工具说明

2. **修改 `desktop-daemon/src/locales/zh.ts`**
   - 新增 `mcp.scenario_title`、`mcp.scenario_collapse`、`mcp.scenario_expand`、`mcp.scenario_prompt_label`、`mcp.scenario_tool_triggers`
   - 新增 `mcp.scenarios.*` 下 5 组场景中英文文案

3. **修改 `desktop-daemon/src/locales/en.ts`**
   - 同上，英文版本

4. **修改 `desktop-daemon/src/components/SettingsPanel.tsx`**
   - 导入 `Search`, `Lightbulb`, `Camera`, `GitBranch`, `ChevronDown`, `ChevronRight` 图标
   - 导入 `createElement`，`MCP_SCENARIOS`
   - 新增 `scenarioExpanded` 状态（默认展开）
   - MCP Tab 顶部新增可折叠场景预览区块，包含：
     - 折叠按钮 + 标题
     - 5 条场景卡片，每条含：图标、场景描述、AI 对话示例（斜体）、触发工具名（monospace + tooltip）

## 验证

- `npm run build` 通过
- 5 条场景均为用户可直接复制粘贴的一句话
- 工具名使用 monospace 字体 + hover tooltip 展示 schema description
- 支持中英文切换
