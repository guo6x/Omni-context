# Scoring and Composite

七类先分别计算场景分和类别 Macro Score，再对七类等权 Macro Average，避免 40 题类别压过 30 题类别。报告同时保留所有原始子指标、Deterministic Score、Agent-Judged Score、Memory Reliability、Personalization、Temporal/Conflict、Insight/Decision。

确定性评分 v2 使用结构化事实的正/负极性和通用词元覆盖。它修复了 v1 把 `rejected_facts`、`invalidated`、`resolved`、`incorrect report` 等否定文字误算为正向断言，以及只接受连续短语的问题。原始 v1 分数保存在每条结果的 `score_pre_calibration`，v2 写入 `score.calibration_version`；没有重新调用 Answer 或 Judge。

只有 Proactive Insight 和 Decision Quality 使用 LLM Judge。Judge temperature=0、Prompt 固定、严格 JSON Schema、原始响应与结构化结果同时保存、失败有限重试。Answer 与 Judge 都是 `deepseek-v4-flash`，所以 `judge_independent=false`，不得称为独立或人工评审。

Human-like Forgetting 的 `physical_deletion` 和 `memory_compression` 为 `not_implemented`，对应 `memory_compression_ratio=null`，不进入主综合分。
