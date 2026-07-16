# Formal 250

Candidate v3.1 was evaluated after the product freeze without changing the product, Benchmark, prompts, scoring, or dataset.

- Final latest-record accounting: 248 completed, 2 errors, 0 missing.
- Overall cognitive score: `0.8665461073318215`.
- P50/P95 total latency: `150120 ms` / `243581 ms`.
- The two final errors are `formal-v2-memory_evolution-039` and `formal-v2-memory_evolution-040`; both exhausted the configured retries after truncated Answer JSON.
- The initial invocation stopped when the Kimi physical-call limit reached 60. A checkpoint resume ran only Decision Quality 023-030 with a fresh usage ledger; it recovered the quota-stopped item and the seven never-started items. It did not retry the two Answer JSON errors.
- Full raw evidence remains at `D:/OmniContext-candidate-v3.1-final-execution/evidence/12-formal-250`.
- Per-scenario databases and server logs remain at `D:/OmniContext-candidate-v3.1-final-execution/runs/12-formal-250`.

`initial-manifest.json` preserves the quota-stop state. `checkpoint-resume-manifest.json` preserves the recovery invocation. `metrics.json` is computed from latest terminal records.
