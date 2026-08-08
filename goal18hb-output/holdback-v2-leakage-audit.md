# Goal 18HB — Holdback V2 泄漏审计报告

- 审计对象（--fixtures）：`D:\ai_code\Omni-context\goal18hb-output\work\holdback-fixtures.jsonl`（180 条完整记录）
- 方法：gold/答案材料只允许出现在顶层 gold 字段（expected_action、acceptable_explanations、severe_failure_labels、scoring）；扫描全部模型可见输入字段，检查 gold 字段名（含 preferred_action）、动作码（DECIDE/PROPOSE_CONFIRM/CLARIFY/APPROVAL_REQUEST/DEFER/REJECT/KEEP/CONTINUE/REVISE/REVERSE/INVALIDATE/SUPERSEDE/OVERRIDE_HONOR）、答案模板短语、严重失败标签/策略规则 id、scorer 指标名、模型名、dev/validation 结果标记与数值评分线索，并检查可见容器内不得出现 gold 字段名作为键。
- 扫描字段数：15；扫描值总数：2815

## 1. 扫描字段

| 字段路径 | 扫描值数量 | 发现数 |
| --- | --- | --- |
| scenario.prompt | 180 | 0 |
| scenario.distractor_variables | 47 | 0 |
| decision_question | 180 | 0 |
| goal.text | 180 | 0 |
| memory_timeline[].content | 751 | 0 |
| candidates[].label | 379 | 0 |
| candidates[].description | 379 | 0 |
| hard_constraints[].text | 36 | 0 |
| soft_preferences[].text | 36 | 0 |
| evidence.qualified[].fact | 402 | 0 |
| evidence.expired[].fact | 26 | 0 |
| evidence.conflicting[].fact | 27 | 0 |
| historical_decision.question | 84 | 0 |
| historical_decision.conclusion | 84 | 0 |
| execution_outcome.actual_outcome | 24 | 0 |

## 2. 发现（按样本）

| 样本 | 字段路径 | 匹配 token | 类别 |
| --- | --- | --- | --- |
（无发现）

## 3. 发现（按类别）

| 类别 | 发现数 |
| --- | --- |
| gold_field_name | 0 |
| action_code | 0 |
| answer_marker | 0 |
| failure_label_or_rule_id | 0 |
| scorer_metric | 0 |
| model_name | 0 |
| split_or_result_marker | 0 |
| result_hint | 0 |

## 4. 断言

```text
gold_leakage_findings = 0
```

- 结论：**gold_leakage_findings = 0 ✓ PASS**
- 退出码：0
