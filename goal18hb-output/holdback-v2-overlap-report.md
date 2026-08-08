# Goal 18HB — Holdback V2 与已知数据重叠审计报告

- 审计对象（--fixtures）：`D:\ai_code\Omni-context\goal18hb-output\work\holdback-fixtures.jsonl`（180 条记录）
- 已知数据：development（20）、regression（15）、validation（120），共 155 条
  - development / regression 来源：`D:\ai_code\Omni-context-decision-kernel-v1\goal14-output`
  - validation 来源：`D:\ai_code\Omni-context\goal18-output`（validation-set.jsonl 与 validation-gold.jsonl 按 sample_id 连接）
- 自比较排除：相同 sample_id 的样本对不参与统计（0 对）；仅当审计对象与已知数据同源（如用 validation 自身做代理测试）时才会触发。
- 方法：exact_sample_hash = sha256(JSON.stringify(解析后对象))；normalized_scenario_hash 删除 sample_id/split/task_type/title/domain/construction_provenance 与全部 gold 字段（expected_action/acceptable_explanations/severe_failure_labels/scoring）后，递归删除 id/event_id/source_ref/derived_from/targets/at/valid_from/valid_until/query_time/made_at/revisit_at 键再取 sha256；decision_question_hash = sha256(decision_question ?? scenario.prompt)；timeline_hash = sha256(memory_timeline 全部 content 连接)；option_set_hash = sha256(候选 label+description 排序后连接)。near-duplicate 使用归一化文本（decision_question + 全部 timeline 内容 + 候选 label）的 8-gram Jaccard 相似度。

## 1. Hash 重叠指标

| 指标 | 比较对数 | 命中对数 | 涉及审计样本数 | 状态 |
| --- | --- | --- | --- | --- |
| exact_sample_hash | 27900 | 0 | 0 | PASS |
| normalized_scenario_hash | 27900 | 0 | 0 | PASS |
| decision_question_hash | 27900 | 10 | 6 | CHECK |
| timeline_hash | 27900 | 0 | 0 | PASS |
| option_set_hash | 27900 | 10 | 10 | CHECK |

## 2. 断言

```text
exact_overlap = 0
```

- exact 重叠对数：0；exact 重叠审计样本数：0
- 结论：**exact_overlap = 0 ✓ PASS**

## 3. Near-duplicate 诊断（仅标记，不判失败）

- 归一化文本：decision_question（v1 样本回退到 scenario.prompt）+ 全部 memory_timeline 内容 + 候选方案 label
- 8-gram Jaccard 相似度阈值：>= 0.5 标记为人工复核；比较对数 27900；max 0.529；mean 0.0088
- 标记对数：6

| 审计样本 | 已知样本 | 相似度 |
| --- | --- | --- |
| decision-bench-v2-holdback-tt15-004 | decision-bench-v2-val-tt15-003 | 0.529 |
| decision-bench-v2-holdback-tt15-002 | decision-bench-v2-val-tt15-005 | 0.526 |
| decision-bench-v2-holdback-tt15-002 | decision-bench-v2-val-tt15-001 | 0.513 |
| decision-bench-v2-holdback-tt15-006 | decision-bench-v2-val-tt15-006 | 0.512 |
| decision-bench-v2-holdback-tt15-010 | decision-bench-v2-val-tt15-002 | 0.508 |
| decision-bench-v2-holdback-tt15-007 | decision-bench-v2-val-tt15-006 | 0.504 |

## 4. 结论

- exact_overlap = 0 断言：PASS
- near-duplicate 标记数：6（仅诊断项，不影响通过/失败）
- 退出码：0
