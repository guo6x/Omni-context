# 05 — Main Promotion Report

Goal 23.5 — Repository Consolidation & Main Promotion
Timestamp: 2026-08-12

## Decision

`main` was promoted to the engineering product baseline `product/omni-v3-unified-r1`
(tip d89675a2e9f60cf8b7f9221dd19ca224b9a103e9).

Rationale (per Goal 23.5):
- `main` had been frozen at 960e0cf2 (2026-07-10) while the real product line advanced to the
  product integration branch, which explicitly records itself as the engineering product baseline
  (docs/PRODUCT-BASELINE.md; Goal24 repository audit docs/goal24/00-repository-and-product-baseline-audit.md).
- The product baseline is NOT a scientific freeze; it is the current stable, buildable product state
  and the correct content for GitHub `main` to represent.
- Goal24 (dev/goal24-cli-skills) remains the active next-development line and is NOT merged into main
  (it contains only Goal24 docs; merging the dev branch would blur the main/dev separation for no
  product-code benefit this round).

## CASE A verification

`git merge-base --is-ancestor origin/main origin/product/omni-v3-unified-r1` → exit 0
`git rev-list --left-right --count origin/main...origin/product/omni-v3-unified-r1` → 0    164

main is a strict ancestor of the product baseline (0 unique / 164 ahead) → fast-forward is safe.

## Execution

1. Temp worktree created: `git worktree add .worktrees/main-promo main` (main was not checked out elsewhere).
2. `git merge --ff-only origin/product/omni-v3-unified-r1` → fast-forward 960e0cf2 → d89675a2 (164 commits), no merge commit, no force.
3. Full regression run on the promoted main (see 07-verification-report.md for the results table).
4. One engineering fix committed on main: the desktop controlled-files snapshot was stale inside the
   baseline commit itself (see below); regenerated and committed separately.
5. Consolidation docs committed on main.
6. `git push origin main` (normal push, no force).

## Old / new identity

- OLD MAIN SHA: 960e0cf2abc0c3859a7dbb45eac2555f12035ffd
- NEW MAIN SHA (final origin/main tip): c3398bc (fast-forward 960e0cf2 -> d89675a2, then two consolidation commits b9a8d0e + c3398bc)
- PROMOTION FAST-FORWARD TARGET SHA: d89675a2e9f60cf8b7f9221dd19ca224b9a103e9 (all 164 baseline commits preserved)
- PRODUCT BASELINE SHA: d89675a2e9f60cf8b7f9221dd19ca224b9a103e9
- GOAL24 HEAD SHA: 9b7d60c2ee29e6e53cacfeebecfc3f4f86f9da4e (unchanged)

## Pre-existing baseline defect found & fixed (engineering only)

`desktop-daemon/scripts/controlled-files.sha256.json` (the Tauri controlled-file guard snapshot)
did not match the files committed in the baseline itself: `desktop-daemon/package.json` and
`desktop-daemon/src-tauri/src/hardware.rs` hadhes differed from the snapshot recorded in commit
7d98077/26dff3e (snapshot generated 2026-08-05T07:47:55Z, files edited afterwards without re-snapshot).
This made `npm run verify:controlled` fail on a fresh checkout of the accepted baseline.

Disposition: regenerated the snapshot with the repo's own command
(`npm run snapshot:controlled`) so the guard matches the committed files; `npm run verify:controlled`
now PASSES. This is a build-guard file, not a scientific artifact; no frozen experiment, Gold, scorer,
raw output, or Holdback content is affected. Committed as a separate engineering commit.

## README audit result

README.md / README.zh-CN.md on the promoted main already reflect the product baseline: the honest
"Product baseline status" banner is present, the tool list is current (26 MCP tools, canonical count
from mcp_tool_manifest.json), and there are no claims that Goal24 capabilities (CLI-first, Skill
runtime, Evidence Surface Guard) are complete. No README changes were needed.
