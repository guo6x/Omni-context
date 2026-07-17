# LongMemEval Preregistration v4

## Status

`NOT AUTHORIZED / NOT RUN`

This preregistration was created before any formal dataset access, Gold access, or formal run. It supersedes v3 and is the current preregistration for the Omni-Context Candidate v3.1 LongMemEval-S formal evaluation.

## Supersession Reason

v4 supersedes v3 after a final pre-data-access integrity audit identified:

1. Engine commit/file mismatch — v3 bound the engine to the adapter commit `b084744` instead of the actual engine-file last-modification commit `55f793b`.
2. Gold projection hash not bound to scoring authorization — v3 used a single ambiguous `dataset_sha256` that conflated Generation projection and Gold projection.
3. Generation terminal errors being interpreted as abstentions — `status=error, hypothesis=null` results were sent to Kimi as abstentions instead of being counted as incorrect.
4. Incorrect generation/judge error metrics — the metric set did not separate `generation_terminal_error_rate` from `kimi_judge_error_rate` and did not define `end_to_end_accuracy` with generation/judge errors both counted as incorrect.
5. Missing formal score-log paths — formal scoring did not mandate `--full-score-log-dir` and `--sanitized-score-log`.
6. A crash window between result append and checkpoint persistence — a process crash between `append results` and `save checkpoint` could cause duplicate results on restart.

Pre-access guarantees:

- `formal_dataset_access_before_v4 = false`
- `formal_gold_access_before_v4 = false`
- `formal_500_run_before_v4 = false`

## Frozen Product

| Field | Value |
| --- | --- |
| `product_commit` | `17dc1d0107b0474de84058205a91b302ba290a74` |
| `product_build_sha256` | `af487d47018e3005c82684fd2c576524e12fbbb51dee2a64719fba0e255c2668` |

The frozen product is not modified in this round.

## Frozen Pipeline Commits and File Hashes

| Component | Commit | File SHA-256 |
| --- | --- | --- |
| Adapter (`adapters/longmemeval.mjs`) | `b0847444a7024906f10a3511f705bbde63650c48` | `3883fe995a1d5aa22d605e87f1467e83a6861785ced975ea43c0d09f7a250f44` |
| Engine (`engines/omni-frozen-v3.1.mjs`) | `55f793be55fe14002d49a4c3bb577ee1255a30f9` | `330ea359b09f1071c5e21ae6a293503dff74cb99ef4bd4860506503a82756d82` |
| Formal Runner (`runners/sealed-runner.mjs`) | `0842be6966069cb9e3c8158979366c12dfd90767` | `d63c11d75f4f10951516223583c720aa5cc0e5e439e8c104f707cedbbe149329` |
| Kimi Scorer (`scorers/kimi-longmemeval-v1.mjs`) | `0842be6966069cb9e3c8158979366c12dfd90767` | `54bd9a5c2c13bc6faf2519cdb5ed9755f170a857ee2e344af51b3c63e33c2270` |
| Judge Prompt (`scorers/prompts/kimi-longmemeval-judge-v1.txt`) | — | `6d4cfa724d722553ea79511769fd842afdadfa4cc412de4852dd43ade17448af` |
| Judge Schema (`scorers/schemas/kimi-longmemeval-judge-v1.json`) | — | `e5bab488fa6872c2d4383da61a97509f8fca4d3d16985b96af939508fcd2429f` |
| Scoring Preregistration (`preregistration/longmemeval-kimi-judge-v1.json`) | — | `400ea3e8362339c3fa053a778cf1c766aae493b6ea2377b2ce4c7035ac31d6dc` |
| Authorization Schema (`schemas/authorization-v2.schema.json`) | — | `5ca303271becd4f88d6a0eeb93393aac00abb3ab2d63dd34b392862c7fe1344a` |

The Runner and Scorer are bound to Commit A (`0842be6966069cb9e3c8158979366c12dfd90767`), which contains all v4 integrity repairs. The Adapter and Engine files are unchanged from their respective last-modification commits.

## Authorization Schema v2

`authorization_schema_version = 2`

Authorization is phase-separated. The single ambiguous `dataset_sha256` is replaced by two distinct projections:

- `generation_projection_sha256` — binds the Generation-phase data file
- `gold_projection_sha256` — binds the Score-only-phase Gold file

### Generation Phase

Verifies:

- `generation_projection_sha256` matches the data file
- `allow_formal_generation = true`

The Generation process cannot read the Gold path.

### Score-only Phase

Before parsing Gold:

1. Read Gold bytes
2. Compute SHA-256
3. Compare with `gold_projection_sha256`
4. Stop immediately on mismatch
5. Only then parse Gold

Score-only also verifies:

- `result_sha256`
- `scoring_preregistration_sha256`
- `scorer_module_sha256`
- `judge_prompt_sha256`
- `allow_formal_scoring = true`

Score-only cannot start the product service.

## Crash Recovery

`rebuildStateFromResults` reads existing `results.jsonl` and verifies each `question_id` has at most one terminal result. `mergeCheckpointWithResults` merges results-derived state with checkpoint state and throws on conflict. Terminal results are never re-run.

Formal lock validation enforces:

- `unique question_ids = 500`
- `result terminal rows = 500`
- `duplicate question_ids = 0`
- `completed + generation_terminal_errors = 500`

## Generation Error Policy

Generation terminal errors:

```json
{ "status": "error", "hypothesis": null }
```

- Do NOT invoke Kimi
- Count as `incorrect` in `end_to_end_accuracy`
- Increment `generation_terminal_errors`

Only successful generations with null/empty hypothesis or explicit refusal are sent to Kimi as normal hypotheses.

## Metric Definitions

| Metric | Definition |
| --- | --- |
| `total_questions` | `results.length` |
| `generation_completed` | count of results with `status != error` |
| `generation_terminal_errors` | count of results with `status == error` |
| `generation_completion_rate` | `generation_completed / total_questions` |
| `generation_terminal_error_rate` | `generation_terminal_errors / total_questions` |
| `kimi_calls` | count of Kimi judge invocations (one per successful generation) |
| `kimi_valid_labels` | count of Kimi judge results with `label in {yes, no}` |
| `kimi_judge_errors` | count of Kimi judge results with `label == null` |
| `kimi_judge_completion_rate` | `kimi_valid_labels / generation_completed` (null if denominator 0) |
| `kimi_judge_error_rate` | `kimi_judge_errors / generation_completed` (null if denominator 0) |
| `correct` | count of Kimi judge results with `label == yes` |
| `end_to_end_accuracy` | `correct / total_questions` (generation errors and judge errors both counted as incorrect) |
| `valid_judgment_accuracy` | `correct / kimi_valid_labels` (null if denominator 0; never fabricated as 0) |

## Primary Metrics

- Kimi-K2.6-judged end-to-end QA accuracy
- Generation completion rate
- Generation terminal error rate
- Kimi judge completion rate
- Kimi judge error rate

## Uniqueness and Call Limits

- Gold `question_id` must be unique
- Results `question_id` must be unique
- Results and Gold ID sets must match exactly
- Total questions must equal 500
- Silent skipping of Gold-missing or Results-missing questions is forbidden
- Duplicate question scoring is forbidden
- `kimi_calls <= generation_completed <= 500`
- One logical judge per successful generation; provider physical retry tracked separately

## Score Log Paths

Formal Score-only requires:

- `--full-score-log-dir=<EXTERNAL_PATH>`
- `--sanitized-score-log=<EXTERNAL_PATH>`

Missing either path rejects formal scoring.

Full log fields: `question_id`, `question_type`, `question`, `reference_answer`, `hypothesis`, `abstained`, `label`, `attempts`, `usage`, `latency_ms`, `error_type`, `temperature_parameter_sent`.

Sanitized log fields: `question_id`, `label`, `attempts`, `usage`, `latency_ms`, `error_type`, `generation_status`.

The full log is NOT committed to Git. The manifest records SHA-256 of both logs but never absolute paths.

## Temperature Aggregation

Tracked fields:

- `temperature_zero_sent_calls`
- `temperature_omitted_calls`
- `temperature_fallback_calls`

`temperature_control` classification:

- `fixed_zero` — all calls sent `temperature=0`
- `provider_default_non_configurable` — all calls fell back to provider default
- `mixed` — combination of zero-sent and fallback

Mixed situations (observed in Moonshot smoke) must not be masked.

## Prohibited Labels

- "official LongMemEval score"
- "official GPT-4o score"
- "leaderboard-comparable score"

## OpenAI and Leaderboard

- `official_gpt4o_scorer_used = false`
- `official_gpt4o_scoring_performed = false`
- `leaderboard_comparable = false`

## Formal Status

`NOT AUTHORIZED / NOT RUN`
