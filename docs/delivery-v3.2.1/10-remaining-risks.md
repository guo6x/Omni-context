# Remaining Risks

There are no unresolved P0 issues.

The following P1 limitations remain disclosed:

1. The formal run is phase-composite and the global worktree was not clean, so provenance is `PROVEN_SOURCE_TREE_HASH`, not a single exact commit.
2. Exact historical `dist` bytes were not archived. Their hashes were reproduced from the proven commits using the same dependency tree and toolchain.
3. Independent human review is incomplete. The 15-item record is agent-based and retains the same-model Judge limitation.
4. The append-only raw results intentionally retain two resolved historical error records; final latest-per-question state has zero unresolved errors.

These limitations are evidence-quality disclosures. They do not alter the formal result, database, metrics, model, retrieval behavior, prompts, thresholds, tags, or Release assets, and none meets this task's P0 blocking criteria.
