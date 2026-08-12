# Goal24 Main Promotion Sync — Record

> Purpose: record how the Goal24 development branch was synced with the promoted `main` after Goal 23.5 repository consolidation. This document is a historical record; it does not change the Goal24 scope freeze.

## Summary

- Goal 23.5 promoted the product baseline into `main` and added repository-consolidation documentation.
- Goal 23.5b aligned the `main` README surface with the current product direction (local persistent context + decision-intelligence layer; MCP as one integration surface).
- After that alignment, `main` was merged into `dev/goal24-cli-skills` as a normal (non-rebase, non-fast-forward) merge.
- The original Goal24 scope freeze remains unchanged.
- No scientific artifact (benchmark results, paper results, manuscript, Holdback, Gold, scorer, raw experiment outputs, freeze tags, archive tags) was modified.
- Future Goal24 work now proceeds from the merged `main` + Goal24 history.

## Identity records

| Item | SHA-256 / Commit |
|------|------------------|
| Original Goal24 base (merge-base of main and goal24 before sync) | `d89675a2e9f60cf8b7f9221dd19ca224b9a103e9` |
| `main` tip before Goal23.5b README alignment (Goal 23.5 completion) | `a31ddc9866e5a7bab7916deab423e124d778f7fd` |
| Goal23.5b README alignment commit on `main` | `380648cafae5e7261373fed8dd5b1612d94abd47` |
| `main` tip merged into Goal24 | `380648cafae5e7261373fed8dd5b1612d94abd47` |
| Goal24 tip before merge (original 4 Goal24 docs + scope freeze) | `9b7d60c2ee29e6e53cacfeebecfc3f4f86f9da4e` |
| Main → Goal24 merge commit | `3664e8882edb074d01340089426c55170a503f27` |
| Goal24 tip after sync | `3664e8882edb074d01340089426c55170a503f27` |

## What was merged

- Goal23.5 repository-consolidation documentation under `docs/repository-consolidation/` (7 reports + consolidation manifest).
- Goal23.5 controlled-files snapshot refresh (`desktop-daemon/scripts/controlled-files.sha256.json`).
- Goal23.5b README surface alignment (`README.md`, `README.zh-CN.md`).

## Merge properties

- Merge strategy: `ort` (normal merge; no rebase, no force push).
- Conflicts: none.
- `git merge-base --is-ancestor origin/main HEAD` after sync: exit code 0 (`main` is an ancestor of Goal24).

## Unchanged

- `docs/goal24/00-repository-and-product-baseline-audit.md`, `01-cli-skill-desktop-integration-plan.md`, `02-checkpoint1-current-code-map.md`, `GOAL24_SCOPE_FREEZE.json` — untouched, byte-identical to the pre-sync Goal24 history.
- All scientific freeze tags and archive tags.
- `research/decision-benchmark-holdback-v2` — untouched.

## Sign-off

- Recorded by: Goal23.5b execution agent (owner-authorized).
- Date: 2026-08-12 (local timezone Asia/Shanghai).
- Status: `GOAL23_5B_COMPLETE` (pending push verification).
