# 07 — Verification Report

Goal 23.5 — Repository Consolidation & Main Promotion
Timestamp: 2026-08-12

## 7.1 Remote state

1. `origin/main` points to the stable product baseline → **PASS** (tip at consolidation completion 9c8d4c8; fast-forward target d89675a2e9f60cf8b7f9221dd19ca224b9a103e9)
2. No force rewrite of main → **PASS** (fast-forward only; `git push` without `--force`; old main 960e0cf2 is an ancestor of new main)
3. `dev/goal24-cli-skills` still exists → **PASS** (9b7d60c2ee29e6e53cacfeebecfc3f4f86f9da4e)
4. `research/decision-benchmark-holdback-v2` not modified → **PASS** (tip fd666ba9cd2ecac2bbeea69979271f82c55f66b9; never checked out, merged, or content-read during this task; local working tree on that branch left byte-identical)
5. Historical scientific tags not moved → **PASS** (v0.1.1, v3.0.0, omni-context-evaluation-freeze-v1, evaluation-freeze-candidate-v1/v2/v3.1 tag objects re-read before/after; unchanged; new archive/* tags are additive)
6. Commits of deleted branches all still reachable → **PASS** (19/19 `merge-base --is-ancestor` checks against final retained refs)
7. Branch count clearly reduced → **PASS** (23 → 4)
8. Active topology simple/clear → **PASS** (main + product baseline + dev/goal24 + holdback research; 12 tags carry history)
9. main build/test status recorded → see 7.2
10. git status clean → **PASS for the main worktree after commits**; note: the pre-existing working tree on
    `research/decision-benchmark-holdback-v2` at D:\ai_code\Omni-context contains long-standing local
    modifications/untracked campaign artifacts that predate this task and were intentionally left untouched.

## 7.2 Test results on promoted main (worktree .worktrees/main-promo, Windows 10, Node 22.23.2, Rust 1.97.1)

| Suite | Command | Result |
|-------|---------|--------|
| brain-server typecheck | npm run typecheck (tsc --noEmit) | PASS |
| brain-server build | npm run build (tsc) | PASS |
| brain-server tests | npx vitest run | PASS 344/344 (39 files) |
| brain-server lint | npm run lint | PASS (0 errors, 9 pre-existing warnings) |
| brain-server schema drift | npm run schema:check | PASS |
| desktop frontend build | npm run build (next build) | PASS |
| desktop controlled-file guard | npm run verify:controlled | PASS (after snapshot refresh, see 05) |
| Tauri Rust tests | cargo test --bin omni-context-desktop | PASS 10/10 |
| Tauri fmt | cargo fmt -- --check | PASS |
| Tauri check | cargo check | PASS |
| Tauri clippy | cargo clippy --all-targets | PASS (warnings only, exit 0) |
| browser-extension tests | npm test | PASS 14/14 |
| browser-extension build | npm run build | PASS |
| benchmark tests | npm test (node --test tests/*.test.mjs) | PASS 237/237 |
| repo scripts tests | node --test scripts/package-guard.test.mjs scripts/scan-secrets.test.mjs | PASS 4/4 |
| mobile typecheck | npm run typecheck | PASS |
| mobile product-mode | npm run test:product-mode | PASS |
| dependency audit (CI gate) | npm audit --omit=dev --audit-level=critical | FAIL (pre-existing): brain-server 24 vulns incl. 1 critical; mobile-app 46 vulns incl. 1 critical; desktop-daemon/browser-extension 0 critical |
| MSI packaging | node scripts/package-all.js | NOT RUN (requires pinned local model + signing; explicitly out of scope in baseline report) |
| macOS / Linux builds | — | NOT RUN (Windows-only environment) |
| gitleaks secret scan | CI-only | NOT RUN locally (CI job executes on push) |

Notes:
- Rust tests initially failed due to corrupt build artifacts in `src-tauri/target` (an earlier interrupted
  build left invalid `.rmeta` metadata). `cargo clean` + `CARGO_INCREMENTAL=0` resolved it; 10/10 tests pass.
  This was an environment/cache issue, not a code defect.
- npm audit findings are pre-existing on the accepted baseline commit (dependency advisories, no forced
  upgrades applied; fixing them is out of scope for repository consolidation and would risk behavior changes).

## 7.3 Integrity guarantees

- FORCE PUSH USED = NO
- HOLDBACK TOUCHED = NO
- SCIENTIFIC TAG MOVED = NO
- Frozen experiment artifacts (Gold, scorer, raw outputs, benchmark fixtures, paper freezes) = untouched
- No formal benchmark re-run, no Holdback access, no scientific result modification
