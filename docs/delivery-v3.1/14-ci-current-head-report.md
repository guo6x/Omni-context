# 14 — Current HEAD CI report

Status: `FIXED`

Implementation HEAD `12ed8b578153df538c31544cca85a41605f82acb` completed Continuous Integration #21 successfully in 7m29s:

https://github.com/guo6x/Omni-context/actions/runs/29254745472

All nine enforced jobs are `success`:

1. `secret-scan` — full checkout plus gitleaks reachable-history scan.
2. `dependency-audit` — production dependency audit at critical severity.
3. `brain-server` — `npm ci`, lint, typecheck, tests, build, schema drift.
4. `desktop-web` — `npm ci` and production Web build.
5. `desktop-rust` — frontend prerequisite, fmt, check, clippy, and test.
6. `browser-extension` — `npm ci`, tests, and build.
7. `mobile` — `npm ci`, typecheck, and product-mode tests.
8. `benchmark-scripts` — lockfile-enforced `npm ci` and full benchmark tests.
9. `windows-smoke` — script tests, Brain build, Desktop Web build, and native Tauri `cargo check`.

Two clean-checkout prerequisites were fixed from real CI failures: the Tauri Brain resource glob now has a tracked source placeholder while generated contents remain ignored, and the Rust job builds the Next frontend before invoking Tauri's compile-time context generator. The documentation-only handoff commit is re-run after this report is committed; its current-HEAD result is reported in the final handoff rather than predicted here.

Evidence: `evidence/14-current-head-ci.log`, `evidence/14-desktop-rust-gates.log`, `evidence/14-secret-scan.log`, `evidence/14-dependency-audit-*.log`, `evidence/16-*-full-regression.log`.
