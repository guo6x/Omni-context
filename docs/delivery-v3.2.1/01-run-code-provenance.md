# Formal Run Code Provenance

## Verdict

`PROVEN_SOURCE_TREE_HASH` and `DO_NOT_RERUN` for formal Run `2026-07-14T07-34-44-390Z-daef50a5`.

The run was resumed across committed fixes, so no single commit is claimed for every phase. The accepted question phase used Benchmark commit `0936839f31a1b5c2254d798dd03223f8ab7a9300` and Brain Server commit `7456b5e06b21ab5eda66ca8582465d43ee844ede`. Their combined source-tree SHA-256 is `c904f0f28d2363e28f1200dd78666383ddba1d7b2fc28a668d19c880f4d1b971`.

## Evidence and method

Git reflog and commit timestamps were reconciled with the run launch, ingestion, rebuild, resume, and completion timestamps. The Benchmark runtime scope and complete Brain Server tree were hashed at the phase commits. Clean temporary checkouts reproduced the built Brain Server tree. The final Benchmark runtime scope and Brain Server tree also match Candidate v2.

Initial extraction used commit `09bb7e0241607b3c7af8b5946cc802fc4350faf4`. Ingestion completed 19/19 before the index repair. The accepted question phase began after the two runtime fixes above and completed 199 final questions with zero unresolved errors.

Machine evidence: `evidence/source-tree-provenance.json`.

## Limitations

The global worktree was not clean at launch because unrelated `docs/embedding-audit-v1` content was untracked. Tracked runtime source was committed for each executed phase. Exact historical `dist` bytes were not retained; the sealed hashes are reproducible-build hashes, not a claim that the old byte files survived. These limitations prevent `PROVEN_EXACT_COMMIT` but do not leave the run code unproven.
