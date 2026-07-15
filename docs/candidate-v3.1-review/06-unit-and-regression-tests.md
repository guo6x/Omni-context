# Unit and regression tests

- Brain Server: `316/316` passed.
- New tests: 31 total: 30 selector/grouping/channel/summary/trace unit tests plus one API integration test.
- Typecheck: passed.
- TypeScript build: passed.
- Benchmark static suite: `41/41` passed at commit `1f4c7c4b77ce6ea5f80e41de3c4a1e07373bce08`.
- Product tracked-tree secret scan: passed.

The test-first backend workflow covered channel isolation, group scoping, summary bounds, query-aware temporal eligibility, fixed Top-10 selection, and trace integrity.
