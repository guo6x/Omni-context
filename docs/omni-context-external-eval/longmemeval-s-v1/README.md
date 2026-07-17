# Omni-Context Candidate v3.1 — LongMemEval-S Formal Evaluation (PIPELINE READY FOR AUTHORIZATION V4)

## Final Status

```
LONGMEMEVAL_FORMAL_PIPELINE_READY_FOR_AUTHORIZATION_V4
```

## Round Summary

```
FORMAL DATASET ACCESSED = false
FORMAL GOLD ACCESSED = false
FORMAL PROVIDER CALLS = 0
FORMAL 500-QUESTION RUN = not executed
INFRASTRUCTURE ROUND = v4_integrity_repair
VALIDATE-ONLY = VALID
TESTS PASSING = 100/100 (77 v3 + 23 v4)
NEW TESTS ADDED = 23
FICTIONAL SCORING SMOKE = PASS (14/14 checks, 2 success + 1 generation error, <=4 Kimi calls)
```

## V4 Round Summary

This round performed a final evidence integrity repair on top of the v3 infrastructure. A pre-data-access audit identified six integrity defects that have all been repaired. **No formal data was accessed, no formal Provider call was made, and no Gold was opened during this round.** The formal 500-question run remains NOT AUTHORIZED / NOT RUN.

### V4 Defects Repaired

1. **Engine commit/file mismatch** — v3 preregistration bound the engine to the adapter commit `b084744` instead of the actual engine-file last-modification commit `55f793b`. v4 binds `engine_adapter_commit = 55f793be55fe14002d49a4c3bb577ee1255a30f9` and `engine_adapter_file_sha256 = 330ea359b09f1071c5e21ae6a293503dff74cb99ef4bd4860506503a82756d82`.
2. **Gold projection hash not bound to scoring authorization** — v3 used a single ambiguous `dataset_sha256` that conflated Generation projection and Gold projection. v4 introduces Authorization Schema v2 with phase-separated `generation_projection_sha256` and `gold_projection_sha256`.
3. **Generation terminal errors being interpreted as abstentions** — `status=error, hypothesis=null` results were sent to Kimi as abstentions. v4 skips Kimi for generation errors entirely and counts them as incorrect in `end_to_end_accuracy`.
4. **Incorrect generation/judge error metrics** — v4 defines 12 finalized metrics with exact definitions, separating `generation_terminal_error_rate` from `kimi_judge_error_rate` and defining `end_to_end_accuracy = correct / total_questions` (generation and judge errors both counted as incorrect).
5. **Missing formal score-log paths** — v4 mandates `--full-score-log-dir` and `--sanitized-score-log` for formal scoring; missing either rejects formal scoring.
6. **Crash window between result append and checkpoint persistence** — v4 adds `rebuildStateFromResults` + `mergeCheckpointWithResults` to close the window; terminal results are never re-run.

### V4 Round Commits (development branch)

- **Commit A** (code + tests): `0842be6966069cb9e3c8158979366c12dfd90767` — `fix(external-eval): finalize scoring integrity and sealed authorization`
- **Commit B** (v4 preregistration): `27bad22ec13921e0e80428192aedfd8751b8419b` — `docs(external-eval): freeze LongMemEval v4 formal pipeline`
- **Engine adapter commit**: `55f793be55fe14002d49a4c3bb577ee1255a30f9` (unchanged from v3 selector fix)
- **Adapter commit**: `b0847444a7024906f10a3511f705bbde63650c48` (unchanged from v3 infra)

### V4 File Hash Registry

| File | SHA-256 |
|------|---------|
| adapters/longmemeval.mjs | 3883fe995a1d5aa22d605e87f1467e83a6861785ced975ea43c0d09f7a250f44 |
| engines/omni-frozen-v3.1.mjs | 330ea359b09f1071c5e21ae6a293503dff74cb99ef4bd4860506503a82756d82 |
| runners/sealed-runner.mjs | d63c11d75f4f10951516223583c720aa5cc0e5e439e8c104f707cedbbe149329 |
| scorers/kimi-longmemeval-v1.mjs | 54bd9a5c2c13bc6faf2519cdb5ed9755f170a857ee2e344af51b3c63e33c2270 |
| scorers/prompts/kimi-longmemeval-judge-v1.txt | 6d4cfa724d722553ea79511769fd842afdadfa4cc412de4852dd43ade17448af |
| scorers/schemas/kimi-longmemeval-judge-v1.json | e5bab488fa6872c2d4383da61a97509f8fca4d3d16985b96af939508fcd2429f |
| lib/sealed.mjs | 82191a1840489f0bc6c5e581d08871024a259af71b4b293bda9c9f2cce9c0a39 |
| schemas/authorization-v2.schema.json | 5ca303271becd4f88d6a0eeb93393aac00abb3ab2d63dd34b392862c7fe1344a |
| preregistration/longmemeval-v4.json | 4b5093af545636fbfb2c7337f2157a2db4bc1dbeb811142d60d9d2f8fb51c65e |
| preregistration/longmemeval-v4.md | 8810fe7756746a698d077c44124b6ec0131eaa9f43bcc4e681bb87ebc8df974f |
| preregistration/longmemeval-kimi-judge-v1.json | 400ea3e8362339c3fa053a778cf1c766aae493b6ea2377b2ce4c7035ac31d6dc |
| tests/integrity-v4.test.mjs | ed76eb011ddd4bf57ed1955ce09a90a6b832fc49a441456bff3b0a0661436ae2 |
| tests/kimi-judge.test.mjs | 256591d1c2691f2b57ce73a9c56bd7268957abae03adadc8c02ade5d348fabb0 |

### Authorization Schema v2

Phase-separated authorization replaces the single ambiguous `dataset_sha256`:

- **Generation phase** verifies `generation_projection_sha256` and `allow_formal_generation = true`; cannot read Gold.
- **Score-only phase** verifies Gold bytes SHA-256 before parsing; also verifies `result_sha256`, `scoring_preregistration_sha256`, `scorer_module_sha256`, `judge_prompt_sha256`, `allow_formal_scoring = true`; cannot start product service.

### V4 Metric Definitions

| Metric | Definition |
|--------|-----------|
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
| `end_to_end_accuracy` | `correct / total_questions` (generation and judge errors both counted as incorrect) |
| `valid_judgment_accuracy` | `correct / kimi_valid_labels` (null if denominator 0; never fabricated as 0) |

### V4 Fictional Scoring Smoke Test

Purely fictional data: 2 successful results + 1 generation terminal error, ≤4 Kimi physical calls.

- Kimi physical calls: 2 (≤4) ✓
- Total results: 3 ✓
- End-to-end denominator: 3 ✓
- Generation completed: 2, terminal errors: 1 ✓
- Generation completion rate: 2/3, terminal error rate: 1/3 ✓
- Kimi calls: 2, valid labels: 2, judge errors: 0 ✓
- Kimi judge completion rate: 1, error rate: 0 ✓
- Correct: 2, end-to-end accuracy: 2/3 ✓
- Full log generated with question/reference_answer/hypothesis ✓
- Sanitized log generated with question_id/label/attempts/usage/latency_ms/error_type/generation_status ✓
- Score manifest records both log SHA-256 ✓
- Gold hash lock effective (correct accepted, wrong rejected) ✓
- OpenAI not used ✓
- Temperature control: fixed_zero ✓
- kimi_calls(2) ≤ generation_completed(2) ≤ 500 ✓

### V4 Tests Added (23 new)

1. Engine Commit and file hash binding
2. Gold hash mismatch rejected before parsing
3. Result hash mismatch rejected for scoring
4. Scorer hash mismatch rejected
5. Judge prompt hash mismatch rejected
6. Generation error does not call Kimi
7. Generation error counts as incorrect in end_to_end_accuracy
8. Judge error counts as incorrect in end_to_end_accuracy
9. Generation and judge error rates separately calculated
10. Duplicate result IDs rejected
11. Duplicate gold IDs rejected
12. ID set mismatch rejected
13. Non-500 count rejected for formal scoring
14. Kimi logical calls do not exceed limit
15. Missing full score log path rejected
16. Missing sanitized score log path rejected
17. Crash recovery — result written but checkpoint not updated
18. Temperature mixed aggregation
19. Generation-only auth rejected for scoring phase
20. Scoring-only auth rejected for generation phase
21. rebuildStateFromResults rejects duplicate completed results
22. validateFormalLock rejects non-500 results
23. validateFormalLock rejects duplicate IDs

## V3 Round (Preserved)

The v3 round details are preserved in the `v3_round` block of failure-summary.json. All v3 repairs remain in effect:

- Official parallel-arrays adapter
- Question Date Envelope propagation
- Formal Runner retry and terminal errors
- Kimi-K2.6 scoring protocol
- LongMemEval preregistration v3 (superseded by v4)
- Real end-to-end Brain Server smoke test (12/12 PASS)
- Kimi Judge smoke test (8/8 PASS)

## Preserved Experimental Parameters

- **Product Commit**: 17dc1d0107b0474de84058205a91b302ba290a74 (frozen, not modified)
- **Product Build SHA-256**: af487d47018e3005c82684fd2c576524e12fbbb51dee2a64719fba0e255c2668
- **Answer Model**: deepseek-v4-flash (not modified)
- **Embedding Model**: Xenova/multilingual-e5-large@a19b072cb4f0cc8bf98b4e46f90a787a61380979
- **Answer Prompt SHA-256**: 4eb58be8c29f789618fc15f1da3d7c22d3a36c70de549d559c2bb8fefbb5fd21 (not modified)
- **Answer temperature**: 0
- **Answer max_tokens**: 1200
- **Answer thinking**: disabled
- **Answer Top-K**: 10 (not modified)
- **Concurrency**: 1
- **graph_answer Used**: false
- **Retry Policy**: max_retries_after_initial=2; allowed=[schema_validation, 429, 5xx, network, timeout]; score_based_retry_forbidden=true

## Prohibitions Honored

- No LongMemEval formal data downloaded, read, searched, or previewed
- No Gold accessed
- No formal 500-question run executed
- No frozen product modified
- No answer prompt modified
- No retrieval algorithm changed
- No answer model changed
- No Top-K changed
- graph_answer not enabled
- OpenAI not used
- DeepSeek self-judge not used
- No score-based tuning

## What Was NOT Done

- No formal dataset downloaded or accessed
- No formal Provider calls made
- No Gold accessed
- No formal generation run
- No official GPT-4o scoring
- No leaderboard-comparable score produced

## Next Steps

To proceed with the formal evaluation:
1. A custodian must create a new Authorization Schema v2 file matching all v4 preregistration hashes (generation_projection_sha256, gold_projection_sha256, product_commit, product_build_sha256, adapter_commit, engine_adapter_commit, formal_runner_commit, preregistration_sha256, scoring_preregistration_sha256, scorer_module_sha256, judge_prompt_sha256, allow_formal_generation, allow_formal_scoring, expires_at)
2. The formal Generation run uses `--preregistration=external-eval/preregistration/longmemeval-v4.json` and `--engine-module=external-eval/engines/omni-frozen-v3.1.mjs`
3. After Generation, Score-only uses `external-eval/scorers/kimi-longmemeval-v1.mjs` with Moonshot credentials, `--full-score-log-dir=<EXTERNAL_PATH>` and `--sanitized-score-log=<EXTERNAL_PATH>`
4. Primary metric: Kimi-K2.6-judged end-to-end LongMemEval-S QA accuracy

## Files in This Archive

- README.md — this file
- run-manifest.json — version pins, verification results, blocker details, resolution
- failure-summary.json — structured failure report with v3 and v4 round details
- data-access-log-redacted.jsonl — empty (no data accessed)
