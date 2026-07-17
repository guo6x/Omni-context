# LongMemEval Preregistration v3

## Status

`NOT AUTHORIZED / NOT RUN`

This preregistration was created before any formal dataset access, Gold access, or formal run. It supersedes v2 and is the current preregistration for the Omni-Context Candidate v3.1 LongMemEval-S formal evaluation.

## Supersession Reason

An independent pre-data-access audit identified an official dataset shape mismatch, missing `question_date` propagation, incomplete terminal-error handling, and a scoring protocol mismatch after the project elected not to use OpenAI.

Pre-access guarantees:

- `formal_dataset_access_before_v3 = false`
- `formal_gold_access_before_v3 = false`
- `formal_provider_calls_before_v3 = 0`

## Frozen Product

| Field | Value |
| --- | --- |
| `product_commit` | `17dc1d0107b0474de84058205a91b302ba290a74` |
| `product_build_sha256` | `af487d47018e3005c82684fd2c576524e12fbbb51dee2a64719fba0e255c2668` |

The frozen product is not modified in this round.

## Official Dataset Schema

- `official_dataset_schema = parallel_arrays_v1`
- `session_order_policy = preserve_official_order`

The adapter consumes the official parallel-arrays structure:

```
haystack_session_ids[i]
haystack_dates[i]
haystack_sessions[i]   // array of {role, content} turns
```

All three arrays must exist and have equal length. Session IDs must be non-empty and unique. The adapter preserves the official array order without re-sorting. The `has_answer` field and any non-role/content fields are discarded. The adapter never reads `answer` or `answer_session_ids`.

## Question Date Envelope

- `question_envelope_version = 1`
- `question_envelope_sha256 = 1e26c66a675a17b74e78dd8d1c6624996143a14b47c5b8753e1c67959fdb96cc`

The deterministic envelope prepends the question date to the question:

```
Current Date: <questionDate>
Question: <question>
```

When `questionDate` is empty, the envelope is `Question: <question>` only.

This envelope is propagated to both:

1. `unifiedMemorySearch(questionEnvelope, 10)` — retrieval sees the date.
2. `CognitiveProvider.answer()` via `scenario.question` — the answer provider sees the date.

The envelope is not a diagnostics-only field. Diagnostics additionally record `original_question`, `question_date`, `question_envelope_version`, `question_envelope_sha256`. Diagnostics never record Gold.

## Engine Adapter

- `engine_adapter_file_sha256 = bac75adfde3945686c733eefe6f912ed24f7e5b816c9ae472884ff421deb37dc`
- `engine_interface = createEngine-v1`
- `engine_module_path = external-eval/engines/omni-frozen-v3.1.mjs`

The engine adapter exposes `createEngine` and integrates the Question Date Envelope into both retrieval and answering.

## Formal Runner

- `formal_runner_file_sha256 = d45b1d6f23722ff0fe8e65bb9290a57812e5bfd090d68c415d0502ad5097b62c`
- `formal_runner_path = external-eval/runners/sealed-runner.mjs`

### Retry Policy

- `max_retries_after_initial = 2` (initial attempt + 2 retries = 3 total attempts)
- Allowed retry triggers: `schema_validation`, `429`, `5xx`, `network`, `timeout`
- `score_based_retry_forbidden = true` — retry is forbidden for answer content, quality, or score.

### Terminal Error Retention

- `per_question = true`
- `max_attempts = 3`
- Checkpoint fields: `completed_ids`, `terminal_error_ids`
- Terminal completion condition: `completed + terminal_errors = 500`
- Resumable: yes. Only interrupted questions without a terminal state are retried; completed and terminal-error questions are skipped.

Each attempt records sanitized fields only: `question_id`, `attempt`, `status`, `error_type`, `started_at`, `completed_at`. The attempt log never records the question text, Gold, or the full answer.

When retries are exhausted, a terminal-error row is written to `results.jsonl`:

```json
{"question_id":"...","status":"error","hypothesis":null,"error_type":"...","attempts":3}
```

After `completed + terminal_errors = 500`, the Results Hash is locked.

## Scoring Protocol

- `scoring_protocol = kimi-longmemeval-judge-v1`
- `judge_provider = Moonshot`
- `judge_model = kimi-k2.6`
- `max_logical_calls = 500`
- `max_retries_after_initial = 2`
- `score_based_retry_forbidden = true`
- `max_output_tokens = 10`
- `temperature_control = provider_default_non_configurable` (the Moonshot API does not accept an explicit `temperature=0`; the parameter is not sent. The temperature is the provider default and is not falsely reported as `0`.)
- `temperature_parameter_sent = false`

### Judge Input

Only these fields are sent to the judge:

- `question_id`
- `question_type`
- `question`
- `reference_answer`
- `hypothesis`
- `abstained` (boolean)

### Judge Output

The judge outputs exactly one of:

```json
{"label":"yes"}
```

```json
{"label":"no"}
```

No other fields are permitted.

### Judge Rubric

The rubric implements the official task-type semantics from the pinned official repository commit `9e0b455f4ef0e2ab8f2e582289761153549043fc`:

- `single-session-user`
- `single-session-assistant`
- `single-session-preference`
- `multi-session`
- `temporal-reasoning` (official date off-by-one is accepted)
- `knowledge-update` (latest answer must be correct)
- `abstention` (null/empty hypothesis is correct)
- `no-answer`, `conflict-update`, `same-name-entity`, `multiple-timestamps`, `long-session-chunking`

### Sanitized Logging

- Full local logs are kept outside the repository.
- Git archives only: `question_id`, `label`, `attempts`, `usage`, `latency_ms`, `error_type`.
- Git never archives: `question`, `gold`, `reference_answer`, `full_hypothesis`.

## Scoring Preregistration

- `scoring_preregistration_path = external-eval/preregistration/longmemeval-kimi-judge-v1.json`
- `scoring_preregistration_sha256 = 9bc6cfdb4742163765f32cbab7a3194c0840bb63cd7794ea9d00ef178a4108ff`

## File Hashes

| File | SHA-256 |
| --- | --- |
| `external-eval/adapters/longmemeval.mjs` | `3883fe995a1d5aa22d605e87f1467e83a6861785ced975ea43c0d09f7a250f44` |
| `external-eval/engines/omni-frozen-v3.1.mjs` | `bac75adfde3945686c733eefe6f912ed24f7e5b816c9ae472884ff421deb37dc` |
| `external-eval/runners/sealed-runner.mjs` | `d45b1d6f23722ff0fe8e65bb9290a57812e5bfd090d68c415d0502ad5097b62c` |
| `external-eval/scorers/kimi-longmemeval-v1.mjs` | `a26a59e698b4987f954401d794bc9bdf8e8fd65b2894f22c1bc269268bfdeca5` |
| `external-eval/scorers/prompts/kimi-longmemeval-judge-v1.txt` | `6d4cfa724d722553ea79511769fd842afdadfa4cc412de4852dd43ade17448af` |
| `external-eval/scorers/schemas/kimi-longmemeval-judge-v1.json` | `e5bab488fa6872c2d4383da61a97509f8fca4d3d16985b96af939508fcd2429f` |
| `external-eval/preregistration/longmemeval-kimi-judge-v1.json` | `9bc6cfdb4742163765f32cbab7a3194c0840bb63cd7794ea9d00ef178a4108ff` |

## Metrics

Primary metrics:

- `Kimi-K2.6-judged QA accuracy`
- `completion rate`
- `terminal error rate`

Removed/closed from v2:

- `official_scorer_preferred`
- `official LongMemEval QA accuracy`

## OpenAI and Leaderboard Guarantees

- `official_gpt4o_scorer_used = false`
- `official_gpt4o_scoring_performed = false`
- `leaderboard_comparable = false`

This score must not be referred to as:

- `official LongMemEval score`
- `official GPT-4o score`
- `leaderboard-comparable score`

The metric name is fixed as `Kimi-K2.6-judged LongMemEval-S QA accuracy`.

## Answer Path

- `answer_path = unified_memory_search_top10_then_answer_v2`
- `graph_answer_used = false`
- `answer_model = deepseek-v4-flash`
- `embedding_model = Xenova/multilingual-e5-large@a19b072cb4f0cc8bf98b4e46f90a787a61380979`
- `prompt_sha256 = 4eb58be8c29f789618fc15f1da3d7c22d3a36c70de549d559c2bb8fefbb5fd21`
- `answer.max_tokens = 1200`
- `answer.temperature = 0`
- `answer.thinking = disabled`
- `retrieval.candidate_pool = 50`
- `retrieval.final_context = 20`
- `retrieval.answer_top_k = 10`

## Runtime

- `concurrency = 1`
- `request_timeout_ms = 90000`
- `dynamic_port = true`
- `isolated_database_per_question = true`
- `service_identity_attestation = true`
- `product_build_attestation = true`
- `infrastructure_restart_allowed = true`

## Run Validity

A run is invalid only if:

- dataset corruption
- adapter crash before any interpretable answer
- service identity mismatch
- Gold exposure during generation
- judge provider global outage before any valid judgment

A run is NOT invalid for:

- low score
- retrieval failure
- wrong answer
- uneven category performance
- valid but poor answer JSON
- product capability limitation
- judge label mismatch

## Commit References

The `engine_adapter_commit`, `formal_runner_commit`, and `adapter_commit` fields reference the commit that contains the round's infrastructure fixes. These are populated after the commit is created and are verified by the validate-only runner through file hashes (not commit hashes).

## Preserved Preregistrations

- `external-eval/preregistration/longmemeval-v1.json` — preserved, read-only
- `external-eval/preregistration/longmemeval-v2.json` — preserved, read-only
- `external-eval/preregistration/locomo-heldout-v1.json` — preserved, read-only