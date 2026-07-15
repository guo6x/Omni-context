# Unit and regression tests

- Candidate gate group: 12 files, 92/92 tests passed on the stable Windows single-worker configuration.
- Focused post-fix tests: 10/10 passed.
- Benchmark static suite: 41/41 passed with the Benchmark worktree remaining clean.
- TypeScript typecheck: passed.
- Brain Server build: passed.
- Secret scan: passed.
- Prohibited product-string scan: passed.

The complete Brain Server suite also passed when split into single-worker batches. A single all-files parallel invocation is unreliable on this Windows host because the native sqlite3 process can exit during worker teardown; no assertion failure was observed, so evidence uses the stable single-worker gate.

See `evidence/regression-check.json` and `evidence/secret-scan.json`.
