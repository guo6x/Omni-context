# 2026-05-21 - MCP Tools Polish

## 任务目标

打磨 MCP 工具面使其对外部 AI 真正可用：(1) `vector_search` 从接受向量数组改为接受文本，服务端自动生成 embedding；(2) 所有工具 description 重写为面向外部 AI 的视角。

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `brain-server/src/mcp-server.ts` | `vector_search` 入参 `embedding` → `query` 字符串，实现改为 `embeddingService.embed` + `vectorSearch`；13 个工具 description 重写为 AI-facing |

## 关键说明

- `vector_search` 改为接受 `query` 字符串后，与 `unified_memory_search` 的定位区分：前者是纯语义向量相似度搜索，后者是三层融合检索
- 所有 description 删除了内部黑话（"核心入口"、"用于3D可视化"、"[统一记忆检索]"、"自动注入每次对话系统提示词"），改为讲清"何时调 + 返回什么"
- 风格与 `get_decision_context` 保持一致（英文，面向接入的外部 AI）

## 自测结果

```
brain-server: npx tsc --noEmit → 通过
```

## 已知遗留

无。
