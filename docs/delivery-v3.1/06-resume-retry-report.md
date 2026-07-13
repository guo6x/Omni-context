# 06 — Resume and Retry Report

Status: **PARTIALLY_FIXED**  
Implementation commit: `469dea3e669cd28b5a3a4ece351c5c6b3e23a02e`

## Fixed state-machine defects

- `skipped` now means only an already-completed question skipped on resume. A run is complete when `done + skipped == total` and there are no current errors; skipped questions no longer force a false `partial` status.
- Shutdown no longer persists an unstarted/interrupted question as `error`. The active invocation stops with `interrupted`, preserving completed JSONL records for resume.
- Each public run/resume/retry invocation starts with a clean in-process shutdown flag, matching the real CLI's new-process behavior.
- Retry totals count actual persisted `status=retry` records, including retrieval failures; they no longer depend only on answer/judge counters and therefore no longer remain incorrectly zero.
- Retry count and configurable retry/backoff settings are written into the immutable config hash.
- The manifest persists expected, completed, error, retry, skipped, and interrupted statistics.
- `retry-errors` derives final status from the latest record for every question in the run, not merely from the number attempted in the retry invocation.
- Duplicate completed records remain rejected by the run store and are explicitly counted in the post-retry consistency summary.

## Integration proof

The production runner, isolated child-process runtime, HTTP client, persisted database, manifest, ingestion marker, and JSONL run store were exercised together with a deterministic provider fixture:

1. A three-question run completed two questions and requested shutdown.
2. The manifest became `interrupted`; two completed records remained durable.
3. Resume used the exact same run ID and database, did not re-ingest, skipped exactly two completed questions, and executed exactly one remaining question.
4. Final JSONL contained exactly three unique completed question IDs and no duplicate completion.
5. A separate run injected a real Judge exception, produced a latest `error`, restored the service, and `retry-errors` executed only that question.
6. Post-retry status became `completed`, latest errors became zero, and the previously completed questions were not repeated.
7. A transient Judge failure produced one persisted retry record and manifest retry count `1`, proving retries are not hard-coded to zero.

Full benchmark result after the change: **74 top-level tests / 157 total tests passed**.

Evidence: `evidence/resume-retry/benchmark-tests.log`.

## Remaining formal acceptance

The task specification requires an actual OS `SIGINT` and a real recoverable Judge outage during the official Conversation 1 run. That run depends on the missing formal LLM/embedding configuration documented in report 04. The deterministic integration proves the state machine and disk invariants, but it is not presented as the official provider-backed interruption run.

Task 5 remains `PARTIALLY_FIXED` until the official Conversation 1 run records the before/after JSONL diff, resume log, retry log, unchanged run ID, unchanged ingestion, complete final question count, and zero duplicate completions.
