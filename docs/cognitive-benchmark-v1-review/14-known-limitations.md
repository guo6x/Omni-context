# Known Limitations

1. Formal Draft 尚未冻结，模板组合有限；Development 分数可能显著乐观。
2. Retrieval-Only 在短场景中几乎获得全部事件，因而高于 Full Omni；这反映基线设计/数据难度，不应隐藏。
3. Answer、Judge、Agent Review 都使用 deepseek-v4-flash；Judge 非独立，Agent Review 非人工。
4. 确定性 scoring v2 是通用结构化词元启发式，不等价于完备语义判定。
5. Cross-Agent 来源标签经过抽取后保真不足；开发集 provenance 为 0.5333。
6. `physical_deletion`、`memory_compression` 未实现，`memory_compression_ratio` 无法测量。
7. Extraction Provider Token 未由冻结 API 暴露；成本中使用显式代理。
8. Development 只有 5 题/类、基线 3 题/类，不能给统计显著性或出版结论。
9. 本轮没有官方 LoCoMo 结果、Formal 分数或正式三模式结论。
