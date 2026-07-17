# Omni-Context Candidate v3.1 — LongMemEval-S Formal Evaluation (PIPELINE READY)

## Final Status

```
LONGMEMEVAL_FORMAL_PIPELINE_READY
```

## Round Summary

```
FORMAL DATASET ACCESSED = false
FORMAL GOLD ACCESSED = false
FORMAL PROVIDER CALLS = 0
FORMAL 500-QUESTION RUN = not executed
INFRASTRUCTURE ROUND = v3_infrastructure_repair
VALIDATE-ONLY = VALID
TESTS PASSING = 77/77
SMOKE TEST (real Brain Server) = PASS (12/12 checks)
SMOKE TEST (Kimi Judge) = PASS (8/8 checks)
```

## Summary

This directory archives the formal LongMemEval-S sealed held-out evaluation attempt for Omni-Context Candidate v3.1. After the engine adapter was built in the previous round, an independent pre-data-access audit identified five additional infrastructure defects:

1. LongMemEval official data structure incompatibility (parallel arrays vs nested objects)
2. question_date was not propagated into retrieval or answer
3. Scoring preregistration pointed to official GPT-4o, but the project elected not to use OpenAI
4. Formal Runner did not preserve terminal-error records and was not resumable
5. Engine tests used only Mock — no real end-to-end smoke test existed

All five defects have been repaired in the v3 infrastructure round. **No formal data was accessed, no formal Provider call was made, and no Gold was opened during this round.** This was evaluation-side infrastructure development only. The formal 500-question run remains NOT AUTHORIZED / NOT RUN.

## V3 Round Repairs

- **Official Parallel-Arrays Adapter** — external-eval/adapters/longmemeval.mjs now consumes the official LongMemEval schema (haystack_session_ids[], haystack_dates[], haystack_sessions[][]) with strict assertions on array presence, equal length, unique non-empty session IDs, valid turn roles, and automatic discard of has_answer and any non-role/content fields. Original official order is preserved. assertGoldFree still gates Generation Projection.
- **Question Date Envelope** — buildLongMemEvalQuestionEnvelope(question, questionDate) produces a deterministic "Current Date: {questionDate}\nQuestion: {question}" envelope. The envelope is used for BOTH unifiedMemorySearch(envelope, 10) AND CognitiveProvider.answer scenario.question — not just diagnostics. Diagnostics record original_question, question_date, question_envelope_version, question_envelope_sha256. No Gold is recorded.
- **Formal Runner Retry and Terminal Errors** — external-eval/runners/sealed-runner.mjs now performs initial attempt + 2 retries, retryable only on schema_validation, 429, 5xx, network, timeout. Score-based retry is forbidden. Each attempt logs a sanitized record (question_id, attempt, status, error_type, started_at, completed_at) — never Question text, Gold, or full Hypothesis. Retry exhaustion writes a terminal error record to results.jsonl. Checkpoint tracks both completed_ids and terminal_error_ids. Resumable: completed and terminal-error questions are skipped; only interrupted-no-terminal questions resume. Formal completion requires completed + terminal_errors = 500, then Results Hash is locked.
- **Kimi-K2.6 Scoring Protocol** — New external-eval/scorers/kimi-longmemeval-v1.mjs implements the judge with Moonshot provider, model kimi-k2.6, max 500 calls, max retries 2, max output tokens 10, fixed output {"label":"yes"} or {"label":"no"}. Temperature is attempted at 0; if the provider rejects it, temperature_control is recorded as provider_default_non_configurable (no fabricated temperature=0). Full logs are kept outside the repo; Git archives only question_id, label, attempts, usage, latency, error_type. Metric name is fixed as "Kimi-K2.6-judged LongMemEval-S QA accuracy". official_gpt4o_scoring_performed=false and leaderboard_comparable=false are recorded. The prohibited labels "official LongMemEval score", "official GPT-4o score", and "leaderboard-comparable score" are forbidden.
- **LongMemEval Preregistration v3** — external-eval/preregistration/longmemeval-v3.json and longmemeval-v3.md supersede v2. v1 and v2 are preserved unmodified. v3 records formal_dataset_access_before_v3=false, formal_gold_access_before_v3=false, the official_dataset_schema=parallel_arrays_v1, session_order_policy=preserve_official_order, question_envelope_version, question_envelope_sha256, engine_adapter_commit, engine_adapter_file_sha256, formal_runner_commit, formal_runner_file_sha256, scoring_protocol=kimi-longmemeval-judge-v1, scoring_preregistration_sha256, official_gpt4o_scorer_used=false, leaderboard_comparable=false. Primary metrics are Kimi-K2.6-judged QA accuracy, completion rate, terminal error rate. official_scorer_preferred and official LongMemEval QA accuracy are removed. Status remains NOT AUTHORIZED / NOT RUN.
- **Validate-only Update** — v1 and v2 preserved; v3 is the current version; formal data not accessed; adapter hash, engine hash, formal runner hash, envelope hash, Kimi judge prompt hash all match; judge model is kimi-k2.6; OpenAI scorer disabled; leaderboard_comparable=false; product commit and build hash unchanged; top-k=10; answer temperature=0; graph_answer=false.
- **Real End-to-End Smoke Test** — After v3 was committed, a real smoke test was run with purely fictional data: 2 fictional sessions, 1 fictional question, max 20 Provider physical calls. Real frozen Brain Server was started with an isolated temporary database, real Embedding (Xenova/multilingual-e5-large), and real DeepSeek extraction/reranking/answer generation. All 12 checks PASSED: runtime attestation, product commit, product build hash, session ingestion, embedding rebuild, unified retrieval, question_date propagation, answer schema, result output, runtime shutdown, database hash generated, not-formal-benchmark. Provider calls: 5/20. Answer model: deepseek-v4-flash. Evidence count: 9. The fictional smoke test is NOT a formal Benchmark result.
- **Kimi Judge Smoke Test** — With purely fictional Question, Reference Answer, and Hypothesis, the Kimi Judge smoke test exercised the real Moonshot API. All 8 checks PASSED: credentials available, judge call succeeded, metric name correct, judge model correct, GPT-4o not used, leaderboard not comparable, label returned, sanitized log written. Temperature fallback worked (provider_default_non_configurable).

## V3 Round Commits (development branch)

- **v3_infra**: b0847444a7024906f10a3511f705bbde63650c48
- **backfill_sha**: 418a633d159da6f7485dc5abd2fc71ce0920e3c2
- **selector_fix**: 55f793be55fe14002d49a4c3bb577ee1255a30f9 (current HEAD of codex/omni-external-eval-and-paper-v1)

## File Hash Registry (V3 Round)

| File | SHA-256 |
|------|---------|
| adapters/longmemeval.mjs | 3883fe995a1d5aa22d605e87f1467e83a6861785ced975ea43c0d09f7a250f44 |
| engines/omni-frozen-v3.1.mjs | 330ea359b09f1071c5e21ae6a293503dff74cb99ef4bd4860506503a82756d82 |
| runners/sealed-runner.mjs | d45b1d6f23722ff0fe8e65bb9290a57812e5bfd090d68c415d0502ad5097b62c |
| scorers/kimi-longmemeval-v1.mjs | a26a59e698b4987f954401d794bc9bdf8e8fd65b2894f22c1bc269268bfdeca5 |
| scorers/prompts/kimi-longmemeval-judge-v1.txt | 6d4cfa724d722553ea79511769fd842afdadfa4cc412de4852dd43ade17448af |
| scorers/schemas/kimi-longmemeval-judge-v1.json | e5bab488fa6872c2d4383da61a97509f8fca4d3d16985b96af939508fcd2429f |
| preregistration/longmemeval-kimi-judge-v1.json | 9bc6cfdb4742163765f32cbab7a3194c0840bb63cd7794ea9d00ef178a4108ff |
| preregistration/longmemeval-kimi-judge-v1.md | 6b14c91c28474013d795b6f4c827a424d37e6f58700c808a46ca829198208e8a |
| preregistration/longmemeval-v3.json | b5f0f17a88b70056eff997b73c8a0d1ca430147269c75ca41d36f4066e3f8f01 |
| preregistration/longmemeval-v3.md | 85230674446b6f311922a992931fd620d47649e69ce3629dc2e6fe7b69d6b4e5 |
| fixtures/longmemeval-generation-12.json | 1e9ee1aec948b66794a316113dc7e5e1c6df36fe9a798d0b5693ea84a3f25baf |
| tests/mock-engine.mjs | 68c2b448c18c2963b9465ba4ddabd3b214242d39cbfb74ea7ea4612f46b18db0 |
| tests/omni-engine.test.mjs | eb5870144616a508b8d419ccc3058d650c85411195daf22ec9bd65c322807795 |
| tests/kimi-judge.test.mjs | 0d497671a0d6f05f143e39a700bbf821948d264168cacc04fa399c78e4384507 |
| tests/longmemeval-adapter-v3.test.mjs | 6efbd0d25bb44a18bd668163788174dc79c5e4554236d4707a98c5bac2a23fc1 |
| tests/sealed-runner-retry.test.mjs | 89b82f48e910b3b081d2c255d2373e7fc01068d5d57983c155795c865092bfa1 |
| tests/sealed-runner.test.mjs | 12a99f0626dee70b644c1a6dd82af39336920770b7c08f09841c377be162f112 |
| Question Envelope version | 1 |
| Question Envelope SHA-256 | 1e26c66a675a17b74e78dd8d1c6624996143a14b47c5b8753e1c67959fdb96cc |

## Preserved Experimental Parameters

- **Product Commit**: 17dc1d0107b0474de84058205a91b302ba290a74 (frozen, not modified)
- **Product Build SHA-256**: af487d47018e3005c82684fd2c576524e12fbbb51dee2a64719fba0e255c2668
- **Answer Model**: deepseek-v4-flash
- **Embedding Model**: Xenova/multilingual-e5-large@a19b072cb4f0cc8bf98b4e46f90a787a61380979
- **Answer Prompt SHA-256**: 4eb58be8c29f789618fc15f1da3d7c22d3a36c70de549d559c2bb8fefbb5fd21
- **Answer temperature**: 0
- **Answer max_tokens**: 1200
- **Answer thinking**: disabled
- **Answer Top-K**: 10
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
1. A custodian must create a new authorization file matching all v3 preregistration hashes
2. The formal run can proceed from Phase 1 using --engine-module=external-eval/engines/omni-frozen-v3.1.mjs and --preregistration=external-eval/preregistration/longmemeval-v3.json
3. After generation, scoring uses external-eval/scorers/kimi-longmemeval-v1.mjs with Moonshot credentials

## Files in This Archive

- README.md — this file
- run-manifest.json — version pins, verification results, blocker details, resolution
- failure-summary.json — structured failure report with v3 round details
- data-access-log-redacted.jsonl — empty (no data accessed)
