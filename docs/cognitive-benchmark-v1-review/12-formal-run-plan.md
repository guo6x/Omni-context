# Formal Run Plan

当前状态：Formal `DRAFT_NOT_FROZEN`；Comparison `DRAFT_NOT_RUN`。本轮没有启动任何正式场景。

外部审查通过后才可：

1. 扩展并人工/独立审查 250 场景的多样性、Gold 和难度。
2. 冻结数据集、Comparison 70 ID、Config/Prompt/Dataset Hash。
3. 在新分支和全新 D 盘运行目录执行 250 Full Omni，增量写盘并定期校验 Checkpoint。
4. 完成后才执行预选 70 的三模式对照；不得重选题。
5. 运行 Agent/人工复核计划，重算指标和成本，保留所有错误与低分。
6. 只有完整性、泄漏、安全和可复现性通过后，才能讨论正式结论。

建议并发仍为 1。SIGINT 后停止接收新场景、完成当前原子写盘，Resume 跳过 completed；Retry Errors 只重跑 error key。
