# Final Freeze CI

The Final Freeze requires exact-commit GitHub Actions success for all nine jobs: `secret-scan`, `dependency-audit`, `brain-server`, `desktop-web`, `desktop-rust`, `browser-extension`, `mobile`, `benchmark-scripts`, and `windows-smoke`. Candidate v2 CI is retained as historical evidence and cannot substitute for this run.

GitHub allocates a run ID only after the immutable Final Freeze commit is pushed. Embedding that future URL in the same commit would create an unsatisfiable self-reference. The committed machine record therefore defines the required jobs and binding locations. After exact-commit CI succeeds, the annotated freeze tag is the authoritative immutable record for `Freeze Commit`, `Final Freeze CI URL`, and `Final Freeze CI Result`.

Machine binding specification: `evidence/final-freeze-ci.json`. A freeze tag must not be created unless the exact tagged commit has 9/9 success.
