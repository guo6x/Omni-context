# 14 — Current HEAD CI report

Status: `BLOCKED`

The v3.1 branch has not yet been pushed at the time of this report commit, so no current-HEAD GitHub Actions run is claimed. Task 13 remains blocked until the pushed report HEAD completes all nine jobs successfully.

## Enforced jobs

1. `secret-scan` — full checkout plus gitleaks reachable-history scan.
2. `dependency-audit` — production dependency audit at critical severity.
3. `brain-server` — `npm ci`, lint, typecheck, tests, build, schema drift.
4. `desktop-web` — `npm ci` and production Web build.
5. `desktop-rust` — fmt, check, clippy, and test.
6. `browser-extension` — `npm ci`, tests, and build.
7. `mobile` — `npm ci`, typecheck, and product-mode tests.
8. `benchmark-scripts` — lockfile-enforced `npm ci` and full benchmark tests.
9. `windows-smoke` — script tests, Brain build, Desktop Web build, and native Tauri `cargo check`.

Local pre-push evidence is green at the enforced level: benchmark 224/224, Browser 14/14, Rust tests 10/10, Brain 241/241 with one worker, Rust fmt/check/clippy exit 0, repository policy secret scan exit 0, and all four dependency audits contain zero critical advisories. GitHub remains the source of truth for Task 13.

Evidence: `evidence/14-desktop-rust-gates.log`, `evidence/14-secret-scan.log`, `evidence/14-dependency-audit-*.log`, `evidence/16-*-full-regression.log`.
