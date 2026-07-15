# Unit and regression tests

- Candidate gate group: 12 files, 92/92 tests passed on the stable Windows single-worker configuration.
- Focused post-fix tests: 10/10 passed.
- Benchmark static suite: 41/41 passed with the Benchmark worktree remaining clean.
- TypeScript typecheck: passed.
- Brain Server build: passed.
- Secret scan: passed.
- Prohibited product-string scan: passed.

The complete Brain Server suite passed in one stable single-worker invocation: 35/35 files and 285/285 tests. This includes the extraction diagnostics compatibility assertion for the two first-class raw-event evidence rows added alongside the normalized LLM assertion. Typecheck also passed in the same verification gate.

The first GitHub Actions run exposed the stale pre-change expectation (1 assertion instead of 3); product logic was unchanged. The local exact fix gate is recorded here, while the exact post-push workflow URL and job conclusions are reported from GitHub after the final commit is pushed.

See `evidence/regression-check.json` and `evidence/secret-scan.json`.
