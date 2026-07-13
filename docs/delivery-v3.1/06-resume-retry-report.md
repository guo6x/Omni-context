# 06 — Resume and Retry Report

Status: **FIXED**

Implementation commits: `469dea3e669cd28b5a3a4ece351c5c6b3e23a02e`, `98eaa780e56c723e049c92a55334f285600028f7`, `c5d43c121cd5b7550fc33ea6c11febbacadab9f1`

The production runner was exercised with the real official Conversation 1 run and provider-backed inference.

## Real SIGINT proof

1. The controller observed 3 completed records and sent a real Windows `CTRL_C_EVENT` at `2026-07-13T17:00:00.410922Z`.
2. Node recorded `SIGINT received`, stopped cleanly with exit code 0, and persisted manifest status `interrupted` plus `statistics.interrupted=true`.
3. Four completed records were durable after shutdown; no interrupted question was fabricated as an error.
4. `benchmark:resume` reused run ID `2026-07-13T16-54-49-815Z-1b9d6c9a`, the same database, and the existing ingestion marker. It did not re-ingest 19 sessions or re-execute completed questions.

## Real recoverable Judge failure

The loopback acceptance proxy forced four Judge HTTP 503 responses. After provider restoration, resume finished 198 questions and left exactly one current error. `benchmark:retry-errors` retried only that error, produced the 199th completed result, and did not repeat any other completed question.

Final accounting: 199 completed, 0 errors, 6 persisted retry records, 199 unique completed IDs, 0 missing IDs, 0 duplicate completed IDs, and 206 total JSONL state records. Resume and retry-errors both exited 0.

Evidence: `evidence/benchmark-conv1/acceptance-summary.json`, `results-after-sigint.jsonl`, `results-before-retry-errors.jsonl`, `results.jsonl`, `runner.log`, `resume.log`, `retry-errors.log`, and `provider-proxy-events.jsonl`.
