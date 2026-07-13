# 17 — Remaining risks

Status: `BLOCKED`

## P0 freeze blockers

1. Formal extraction/answer/judge model credentials and semantic embedding configuration are unavailable, so official Conversation 1 has no provider-backed run.
2. Consequently there are no official 19/19 extraction diagnostics, no 199/199 result set, no real metrics/recompute hash, no official OS-SIGINT resume proof, no provider outage/retry proof, and no 10–20 item manual judge comparison.

## Release risks outside the freeze decision

- The Windows NSIS installer is not Authenticode signed.
- Production dependency audits have zero critical advisories, but high-severity advisories remain: `xlsx` has no published fix in the current dependency line; the Desktop Next.js fix requires a breaking major upgrade; Mobile retains 16 high advisories in its current Expo dependency graph.
- The local default-parallel Brain test run was resource-sensitive once on this low-free-space machine; the two affected suites passed individually, the full 241-test suite passed with one worker, and GitHub's default-parallel Brain job passed on implementation HEAD CI #21.

No risk above is hidden by a synthetic metric or a report-authored PASS.
