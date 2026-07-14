# Scenario Generation

固定种子为 `20260714`。生成器创建四个互相独立的数据集：Smoke 21、Development 35、Formal Draft 250、Comparison Draft 70。Scenario ID 在全部 306 个场景中唯一；Smoke、Development 和 Formal 的事件组合分别独立生成。

Formal Draft 分布为 40/40/40/30/40/30/30，Comparison Draft 在正式运行前已按每类 3 easy、5 medium、2 hard 固定，不会根据答案重选。

当前 Formal Draft 是模板化草案：250 行只有 102 个唯一问题文本、222 个唯一事件文本组合。它足以验证 Schema、规模和抽样逻辑，但不足以直接冻结为出版级正式数据集。外部审查应扩展表达、领域、时间结构、冲突形态和约束组合，并重新做重复度检查；不得依据 Omni 的答案改 Gold。

机器文件见 `evidence/dataset-manifest-draft.json`。Formal 状态严格为 `DRAFT_NOT_FROZEN`，Comparison 状态严格为 `DRAFT_NOT_RUN`。
