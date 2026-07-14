# Known Limitations

There are no unresolved P0 issues. Eight P1 disclosures remain part of the freeze:

1. The formal Run is phase-composite.
2. Run code provenance is `PROVEN_SOURCE_TREE_HASH`, not one exact commit for every phase.
3. The original run launched with a globally non-clean worktree because unrelated audit documentation was untracked.
4. Exact historical `dist` bytes were not archived; reproducible-build hashes are retained.
5. Answer and Judge both used `deepseek-v4-flash`, so the Judge is not model-independent.
6. The 15-item review is Agent-based independent review, not human review or independent human annotation.
7. The append-only results retain two resolved historical error records; final unresolved errors are zero.
8. Conversations 2–10 had not been accessed before this freeze.

These are evidence and evaluation limitations. They do not conceal a result change and do not authorize changes to models, prompts, retrieval, weights, thresholds, temporal rules, database, results, or metrics.
