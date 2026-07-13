# 13 — True merge reversibility report

Status: **FIXED**

## Previous gap

The previous `revertMerge()` only removed `metadata.merged_into`. It explicitly did not restore redirected relationships, assertions, FTS rows, or vector rows, so it was not a true undo.

## Reversible snapshot

Before any mutation, `confirmMerge()` now stores a versioned audit snapshot containing:

- the alias's exact metadata and `updated_at`;
- every relationship row that references the alias;
- every assertion row whose subject or object references the alias;
- the alias FTS row;
- the alias vector row encoded losslessly as base64.

Relationship redirects are performed by stable row ID. If redirecting would create a self-loop or violate the unique `(source_id, target_id, type)` constraint, only the alias-origin row is removed; an existing canonical row is never deleted.

`revertMerge()` fails closed on legacy/non-reversible snapshots, restores relationship rows and assertion endpoints, rebuilds alias FTS/vector rows, and restores metadata and timestamp byte-for-byte in one database transaction.

## Strong round-trip test

The test creates both canonical and alias edges that collide only after redirect, plus an inverse edge, explicit assertion, FTS content, nested metadata, and a 384-dimensional vector. It verifies merge removes the alias collision/indices, then verifies revert produces exact pre-merge equality for metadata, relationship rows, assertion rows, FTS rows, and vector bytes while preserving the original canonical collision row.

The focused merge suite passes 24/24 and the full Brain Server suite passes 236/236.

Evidence: `evidence/12-13-agentloop-merge-brain-tests.log`.
