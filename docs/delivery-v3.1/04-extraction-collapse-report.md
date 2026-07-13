# 04 — Extraction Collapse Diagnosis and Repair

Status: **PARTIALLY_FIXED**  
Implementation commit: `b0c061932d95a8c35611b9d5b0b8e358eb82a69f`  
Scope inspected: production extraction path and Conversation 1 loader only. Conversations 2–10 were not loaded, run, counted, or analyzed.

## Freeze impact

The code-level collapse causes and observability gaps are fixed and fully covered by local tests. This task cannot be marked `FIXED` until the official Conversation 1 dataset is ingested through a configured real LLM/embedding environment and the resulting 19 per-session diagnostics plus final database distribution are inspected. The current process and the D-drive workspace contain no non-empty LLM/API environment configuration, so that real run has not been fabricated or replaced with a mock claim.

## Confirmed root causes

1. `/api/graph/extract` discarded the parsed LoCoMo session time and assigned `new Date().toISOString()` to every extraction. Temporal provenance therefore reflected ingestion time rather than event time.
2. Evaluation requests did not set `requireLlmSuccess`. HTTP failures, empty responses, schema failures, and timeouts silently returned the regex fallback.
3. The regex fallback is primarily code-oriented (`class`, `function`, `project`, `tool`) and is not a valid semantic fallback for natural dialogue. A failed dialogue LLM call can consequently produce zero or one incidental entity.
4. One unknown entity type or predicate caused strict Zod validation to reject the entire otherwise valid provider response, even though the downstream extractor already had safe `concept` / `relates_to` fallbacks.
5. Facts whose subject did not exactly match an extracted entity were skipped, but that skip count was only a console warning.
6. The API returned the model's pre-resolution array lengths, not the number of entities, relationships, or assertions actually persisted. This made a response such as `entities: 1` ambiguous and prevented localization of the collapse.
7. The resolver itself is not configured to blindly merge all people, preferences, goals, events, tasks, questions, or projects. Those types are manual/context gated. Before this repair, however, there was no response-level record of create/update/auto-merge/candidate-merge decisions or final active/total database deltas.

## Repair

- The benchmark sends `timestamp`, `session_id`, and `evaluation_mode: true` for every session.
- Dialogue-specific prompt rules require named participants, exact fact-subject/entity matching, durable personal facts, and verbatim source spans.
- Each LLM call now records HTTP status, full raw HTTP response SHA-256 (never raw secret-bearing content), finish reason, parse status, failure reason, parsed counts, and safe domain-label normalizations.
- A single unknown entity type is normalized to `concept`; a single unknown predicate is normalized to `relates_to`. Structural, confidence, source-span, and temporal validation remains strict.
- `finish_reason=length` is a formal failure even when the partial JSON parses.
- Evaluation mode returns structured HTTP 422 diagnostics on extraction failure instead of silently reporting regex-only output as success.
- Entity/assertion timestamps use the dataset session timestamp.
- Missing fact subjects are counted.
- Resolver diagnostics report input/batch/create/update/auto-merge/candidate-merge/reject decisions and rejected relationships.
- The endpoint returns actual database deltas and successful relationship/assertion writes.
- The production runner persists one line per session to `conversation-1/extraction-diagnostics.jsonl`, including both raw/parsed dataset timestamp metadata and the full extraction/resolution/write/database diagnostic chain.

## Verification

- Brain Server TypeScript build: PASS.
- Brain Server full suite: **28 files, 235 tests passed**.
- Benchmark full suite: **73 top-level tests / 154 total tests passed**.
- Focused tests prove raw-response hashing, HTTP diagnostics, safe invalid-label normalization, multi-participant preservation, dataset timestamp propagation, formal schema failure, token truncation failure, structured 422 responses, runner JSONL persistence, and resume reuse.
- Secret scan over the implementation diff: PASS.

Evidence:

- `evidence/extraction-collapse/brain-server-build.log`
- `evidence/extraction-collapse/brain-server-tests.log`
- `evidence/extraction-collapse/benchmark-tests.log`
- `evidence/extraction-collapse/environment-audit.json`
- `evidence/extraction-collapse/verification-summary.json`

`brain-server-tests.failed-before-mock-update.log` is retained only as an iteration record: two legacy tests mocked the old `extract()` method / `.json()` response contract. The mocks were updated to the production `extractWithDiagnostics()` / raw-response contract, and the subsequent full suite passed 235/235.

## Remaining acceptance action

Provide or inject the formal evaluation LLM and semantic embedding configuration without committing secrets. Then run official Conversation 1 only and require:

- exactly 19 completed session diagnostics and zero failed sessions;
- no `disabled`, `http_error`, `invalid_response`, `truncated`, `timeout`, or `transport_error` calls;
- final active entity, relationship, assertion, principle, and type distributions backed by the isolated `brain.db`;
- an explicit comparison against the prior 19-session → 1-entity symptom;
- preservation of `extraction-diagnostics.jsonl`, `brain.db`, database hash, server log, and run manifest.

Until that action passes, Task 3 and the Freeze Candidate remain blocked from a `FIXED` declaration.
