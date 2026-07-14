# Three-Mode Baselines

三种模式共用 Answer 模型、基础 Prompt、temperature=0、最大输出 Token、场景问题、Judge、重试策略。

- No Memory：`memory_context=[]`，只能看到当前问题。
- Retrieval-Only：对事件原文执行固定、可审计的词法重叠排序，Top-4；无图扩展、无长期状态演化、无主动洞察。
- Full Omni：每场景独立数据库，调用冻结版本的抽取、E5-Large 重嵌、统一检索、时间/冲突与上下文链路。

Development 仅 Full Omni 跑 35 题；两条基线各跑固定 21 题（每类前三题）。由于场景只有 4–5 个短事件，Top-4 几乎暴露全部相关历史，Retrieval-Only 是异常强的开发基线。这是有效发现，不是 Full Omni 的胜利证明。
