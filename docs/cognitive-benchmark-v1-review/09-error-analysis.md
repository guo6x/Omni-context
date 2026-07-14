# Error Analysis

20 条固定 Development 记录完成第二次 Agent Review：9 agree、11 flag。全部是 Agent Review，不是人工复核。11 个 flag 主要暴露确定性评分 v1 的通用否定/短语匹配缺陷；该缺陷已由 scoring v2 修复并保留前后分数。

剩余问题：

- 系统：Cross-Agent 来源保真平均 0.5333；显式 Invalidated Fact Rejection 为 0.4。
- 评分：通用词元覆盖仍是启发式；同模型 Judge 可能偏向相似表述。
- 数据：Retrieval-Only 在短模板场景中过强，Formal Draft 多样性不足。
- Gold：20 条 Agent Review 未标记 Gold ambiguity，但该样本不能替代人工/独立审查。
- 泄漏：20 条未标记 memory leakage；代码测试确认 No Memory 为空、Retrieval-Only 不接触 Gold。

没有删除低分场景，也没有根据答案修改 Gold。
