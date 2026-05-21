# 2026-05-21 - Decision Context MCP Tool

## 任务目标

新增 MCP 工具 `get_decision_context`：外部 AI 判断一个具体处境时，一次性拿到相关原则、历史记忆、历史冲突和图谱邻域。工具不做 LLM 推理，只做检索+组织。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `brain-server/src/mcp-server.ts` | 新增 `GetDecisionContextSchema` zod schema、`listTools()` 登记、`callTool()` case 实现 |

## 关键实现说明

- 检索复用 `unified_memory_search` 的三层融合模式（FTS 文本 + 向量 + 图谱邻域）
- 原则 = 核心原则 + 检索结果中的 principle 类型
- 冲突检测：遍历相关实体的 `getRelationshipsForEntity`，筛 `conflicts_with` 且两端都在相关实体集合内的边，key 排序去重
- 图谱邻域以检索 top 命中为种子，深度 2
- 各子步骤独立 try/catch，单项失败不阻塞整体返回
- 工具 description 面向外部 AI 编写，说明何时调用、返回什么

## 自测结果

```
brain-server: npx tsc --noEmit → 通过
```

## 已知遗留

无。
