# Omni-context Restoration Report

**Document type:** Explanation and reference report
**Audience:** Repository maintainers, reviewers, and release operators
**Goal:** Establish what was restored, what was actually verified, what remains risky, and what was deliberately not done.
**Evidence window:** 2026-10-13 through 2026-10-15 (Asia/Shanghai).
**Repository:** [guo6x/Omni-context](https://github.com/guo6x/Omni-context)

## Executive result

The product-line recovery was completed in an isolated worktree and merged to **main** only after the exact candidate head passed the repository GitHub CI, security, Windows smoke/native, mobile compatibility, benchmark, and secret-scan gates.

- Baseline origin/main: 7157aa855734036c08ce2d7a011d3d511e3531c7.
- Reviewed recovery head: 11bbc647b647fd1a8d52820ec461fa652d2ff430.
- Merge commit now on main: 7b732a51856e6fcb7bff4ae9e37f24b9b641540e.
- Integration PR: [#19](https://github.com/guo6x/Omni-context/pull/19), merged 2026-10-14 17:50 UTC.
- All required checks on the exact PR head passed. GitHub ran duplicate push/PR-triggered CI and Security workflows; all corresponding runs succeeded.
- Post-merge main CI and Pages build also completed successfully: [main CI run 38610134259](https://github.com/guo6x/Omni-context/actions/runs/38610134259) and [Pages run 38610131665](https://github.com/guo6x/Omni-context/actions/runs/38610131665).
- The temporary integration/restore-20261014 branch was deleted only after its 25 commits were reachable from main and no extra work remained. The deletion and recovery proof are recorded in [branch-cleanup-20261015.json](./branch-cleanup-20261015.json).

No research branch, scientific freeze tag, paper artifact, submission identifier, author mapping, deployment, paid API call, or external data upload was touched.

## Product slice delivered

The merged Desktop slice is organized around the requested bounded journey:

| Surface | Delivered behavior | Verification |
| --- | --- | --- |
| Ask | Ask-first workspace navigation and natural-language question entry; the existing graph context path remains the source-backed answer surface. | Built and exercised in the real browser preview; synthetic question entry filled successfully. |
| Journey | Navigation opens the decision timeline and closes without leaving the workspace. | Real browser interaction and screenshot evidence. |
| Library | Navigation opens memory/source inspection and closes cleanly. | Real browser interaction and screenshot evidence. |
| Advanced | Navigation opens the Decision Control Center with execution-safety language and server-owned decision/plan status. | Real browser interaction and screenshot evidence. |

The implementation also includes accessibility names for icon-only controls and a guard that keeps Tauri-only global shortcut registration inert in a static browser preview. The guard does not alter the Tauri IPC path.

Relevant browser evidence images are stored outside this Git repository in the session evidence directory \`D:\AI_code\Omni-context\recovery-evidence-20261013\`:

- \`ask-first-restore-20261014.png\` — restored workspace
- \`ask-question-20261014.png\` — synthetic question entry
- \`advanced-control-center-20261014.png\` — Advanced Control Center

## Integrated changes

PRs were not assumed safe merely because they were open. The recovery branch integrated reviewed commits for:

1. Windows canonical executable fixture paths.
2. Brain production dependency remediation and critical audit refresh.
3. Next.js 16/PostCSS upgrade.
4. Mobile shell-quote and tar remediation, lock metadata, and Expo consumer compatibility.
5. Android workflow stabilization, including packages: platform-tools so the pinned setup action no longer requests the removed tools package.
6. Controlled-file integrity checks around Desktop builds.
7. Ask-first Desktop workspace navigation.
8. Architecture and frontend reconciliation documentation.
9. Evidence-driven Desktop accessibility and static-preview hardening.

The exact integrated history is preserved in PR #19 and its merged main ancestry; no squash or force push was used.

## Verification ledger

### Completed and truly verified

**GitHub gates on PR #19 head 11bbc647:**

- Continuous Integration: success — dependency audit, Brain server, Windows smoke, Desktop web, mobile, benchmark scripts, browser extension, Desktop Rust, and secret scan.
- Security: success.
- Mobile Dependency Compatibility: success on Ubuntu, Windows, and macOS; the Android build/setup job also completed successfully.
- Duplicate push-triggered CI and Security runs for the same SHA: success.
- PR state became MERGEABLE / CLEAN before merge.

**Local gates:**

- Desktop Next static production build: passed.
- Desktop controlled-file verification before and after build: passed.
- Desktop Rust: cargo fmt -- --check, cargo check, cargo clippy --all-targets, and cargo test passed; 236 tests passed and 9 were ignored.
- Brain lint, typecheck, build, and generated schema checks passed locally; lint reported 15 warnings and no errors.
- Mobile install/postinstall, Expo/tar consumer tests (4/4), typecheck, and read-only product-mode checks passed.
- Browser extension tests (14/14) and build passed.
- Benchmark suite passed (237/237).
- Root security scanner, repository secret scan, CLI tests, CLI smoke, and dry package passed.
- Production dependency audits using npm audit --omit=dev --audit-level=critical passed against https://registry.npmjs.org for all four shipped components. npm audit fix --force was not used.

**Real browser evidence:**

- Static export served at http://127.0.0.1:3100 after building desktop-daemon/out.
- Ask/Journey/Library/Advanced navigation was visible and interactive.
- Final shipcheck run omni-context-restore-20261014-v3: 16/19 checks passed; content, heading, control/link accessibility, layout, console errors, and uncaught runtime exceptions all passed.

### Executed but still risky or bounded

- The local Windows Brain full Vitest run ended with native sqlite3/Node process exit 134 after many tests had passed. This is not claimed as a local full-suite green result. The remote Brain job on the exact merged candidate passed its unit, migration, backup round-trip, lint, typecheck, build, and schema steps.
- Lower-severity dependency advisories remain. The mobile audit reported 80 (1 low, 27 moderate, 52 high) at the critical-only threshold; the browser extension audit reported 9 non-critical advisories. The critical gate is green, but these are follow-up work and were not force-fixed.
- The final browser shipcheck still reported six ERR_CONNECTION_REFUSED requests to localhost:3001 for health, graph-context, and notifications. The static browser preview intentionally did not start the local Brain service or mint a Tauri local API token. Therefore live source-backed answer retrieval, Journey data, Library data, and server-owned Control Center data were not claimed as end-to-end verified in this preview.
- The static preview originally exposed one Tauri IPC exception and one unlabeled settings control; both were fixed. The final run had no uncaught exceptions and all inspected controls had accessible names.
- GitHub emitted Node.js 20 deprecation and runner migration annotations. They were warnings, not gate failures.

### Not completed / deliberately excluded

- No merge of historical PRs #5–#8 or #12–#18 was performed individually; they remain open drafts or independent historical branches. PR #19 is the only recovery merge.
- No broad branch deletion was performed. Active product, release, research, and merged-history branches remain. Only the temporary recovery branch was deleted after reachability proof; the already-absent remote dev/goal24-cli-skills was not disturbed locally because its primary worktree is still in use.
- No legacy branch protection was added to main; the repository reports no legacy main protection. The active scientific rulesets were observed and preserved: Protect Scientific Holdback protects the decision holdback branch, and Protect Scientific Freeze Tags protects science/* tags.
- No production deployment, release publication, paid model/API request, external upload, anonymous-submission artifact handling, or research result modification was performed.
- No claim is made that mobile lower-severity advisories are resolved, that the local Brain native crash is fixed, or that a live authenticated desktop-to-Brain journey was completed.

## Branch and PR audit

At the baseline snapshot there were 17 remote branches. The temporary integration branch made 18 during review; after merge and safe deletion there were again 17. The documentation report branch then raised the current count to 18; it is recorded separately in the manifest and remains open as PR #20. The complete SHA/ahead/behind/action ledger is in [branch-cleanup-20261015.json](./branch-cleanup-20261015.json).

Current PR disposition at the time of the recovery audit:

| PRs | State | Decision |
| --- | --- | --- |
| #5–#8 | Open drafts | Retain independently; not assumed green and not merged wholesale. |
| #9 | Closed research PR | Retain branch and freeze artifacts; no research mutation. |
| #10 | Merged | Retain branch/history. |
| #12–#18 | Open drafts | Retain independently; proven-safe portions were integrated into #19, but originals were not closed or rewritten. |
| #19 | Merged | Bounded recovery candidate; all exact-head gates passed. |
| #20 | Open | Documentation-only report and branch manifest; awaiting review. |

Tags were enumerated and left untouched, including release tags, Goal27/28/29 milestones, evaluation freezes, archive tags, and the scientific freeze tag. The ruleset audit confirmed deletion and non-fast-forward protections for the holdback branch and update/deletion protections for science/* tags.

## Next development priority

1. Run the Brain Server locally with its Tauri-issued token and add a reproducible authenticated browser/E2E fixture for Ask source citations, Journey records, Library inspection, and Control Center decision plans.
2. Replace the local sqlite3 crash with a deterministic Windows test setup or isolate the native binding failure, then make the full Brain suite a repeatable local gate.
3. Reduce remaining high/moderate mobile and extension advisories without --force; preserve consumer compatibility tests for every upgrade.
4. Decide deliberately whether main should receive equivalent required-check protection; do not weaken the scientific rulesets.
5. Only then close or merge individual historical PRs that have a current owner and fresh evidence.

## Reproduction pointers

- Recovery PR: [#19](https://github.com/guo6x/Omni-context/pull/19)
- Merge commit: [7b732a5](https://github.com/guo6x/Omni-context/commit/7b732a51856e6fcb7bff4ae9e37f24b9b641540e)
- Reviewed candidate: [11bbc64](https://github.com/guo6x/Omni-context/commit/11bbc647b647fd1a8d52820ec461fa652d2ff430)
- PR CI run: [38605624698](https://github.com/guo6x/Omni-context/actions/runs/38605624698)
- Mobile compatibility run: [38605625207](https://github.com/guo6x/Omni-context/actions/runs/38605625207)
- Post-merge main CI: [38610134259](https://github.com/guo6x/Omni-context/actions/runs/38610134259)
- Post-merge Pages build: [38610131665](https://github.com/guo6x/Omni-context/actions/runs/38610131665)
