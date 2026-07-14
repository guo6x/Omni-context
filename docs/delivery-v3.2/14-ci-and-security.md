# CI and security

The local Candidate v2 gate mirrors the nine jobs in `.github/workflows/ci.yml`: secret scan, dependency audit, Brain Server, desktop web, desktop Rust, browser extension, mobile, benchmark scripts, and Windows smoke. The final local run completed with no command failures.

Key local results:

- Brain Server lint: 0 errors (12 pre-existing warnings); typecheck/build/schema drift check passed; full Vitest suite passed.
- Benchmark: 230/230 passed.
- Browser extension: 14/14 passed and production build passed.
- Mobile: typecheck and read-mostly product-mode verification passed.
- Desktop web production build passed.
- Rust: formatting, check, Clippy, and tests passed using a D-drive Cargo target.
- Root package/secret scanner tests and repository secret scan passed.
- Official npm registry production audits passed the configured `critical` gate for all four projects.

The accepted database, JSONL results, manifests, and server log were scanned before repository archival. The API key is read only from the environment; it is absent from Git, run evidence, logs, screenshots, reports, and databases. Model/cache/build storage used D: and the large final installers use E:.

Remote CI status is a hard precondition for the Candidate v2 tag. The tag must be created only after the pushed HEAD reports all nine jobs successful.
