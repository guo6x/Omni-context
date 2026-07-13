# 12 — Task 11: confirmMerge Redirects Graph Edges onto Canonical Entity

**Commit**: `d0e5c41`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
`confirmMerge` was dead code — exported but never called by any HTTP route or MCP tool. Even if called, it only flipped a metadata flag on the alias entity (`metadata.merged_into = canonicalId`) without redirecting any of the graph edges, assertions, FTS rows, or vector embeddings that still pointed at the alias. The alias remained fully reachable from the graph, defeating the purpose of the merge. `revertMerge` used a `LIKE mergeId + '%'` fuzzy match on the audit id (`${mergeId}_audit_${Date.now()}`), which could match the wrong row if multiple candidates shared a mergeId prefix.

## Production Entry Point
Four new HTTP routes in `brain-server/src/api/handlers/index.ts`:
- `GET /api/entities/merge/candidates?status=pending` — list candidates for human review (queue was previously write-only)
- `POST /api/entities/merge/:mergeId/confirm` — calls `confirmMerge`, returns redirect summary
- `POST /api/entities/merge/:mergeId/reject` — calls `rejectMerge`
- `POST /api/entities/merge/:mergeId/revert` — calls `revertMerge`

## Call Chain
1. `GET /api/entities/merge/candidates?status=pending` → returns queue for human review
2. User confirms a merge candidate via `POST /api/entities/merge/:mergeId/confirm`
3. `confirmMerge(db, mergeId)`:
   - Redirects `relationships.source_id` and `target_id` onto canonical using `UPDATE OR IGNORE` (skips UNIQUE constraint collisions)
   - Cleans up self-loops on canonical and orphaned edges on alias
   - Redirects `assertions.subject_id` and `object_id` onto canonical (also repoints mirror assertions from Task 8)
   - Drops alias's FTS and vec rows (canonical's preserved)
   - Refreshes canonical's FTS row so merged descriptions/tags are searchable
   - Soft-hides alias entity (`metadata.merged_into` set, row preserved for audit trail)
   - Records `confirmed_at` and `reviewed_at` on candidate row
   - Writes audit row with stable id `${mergeId}_audit` (no timestamp suffix) and 4 redirect counts
   - Returns `MergeConfirmResult` with all 4 counts + `auditId`
4. `revertMerge(db, mergeId)`:
   - Uses exact id match (`id = '${mergeId}_audit'`) instead of LIKE prefix
   - Throws clearly when audit row not found or already reverted
   - Records `reverted_at` on candidate row
   - Does NOT reverse relationship/assertion redirects (documented limitation)

## Modified Files
- `brain-server/src/db/sqlite.ts` — Migration 22 (`extend_entity_merge_audit_with_redirect_summary`):
  - `entity_merge_candidates`: added `confirmed_at`, `reverted_at` (separate from `reviewed_at`)
  - `entity_merge_audit`: added `redirected_relationships`, `redirected_assertions`, `redirected_fts`, `redirected_vec` (INTEGER NOT NULL DEFAULT 0)
  - New index on `entity_merge_audit(canonical_id, created_at DESC)` for audit history lookup by canonical entity
- `brain-server/src/graphrag/entity-resolver.ts`:
  - `confirmMerge` rewrite: redirects relationships (source + target), assertions (subject + object, including mirror assertions), drops FTS/vec rows, refreshes canonical FTS, soft-hides alias, writes audit with stable id + 4 counts, returns `MergeConfirmResult`
  - `revertMerge` fix: exact audit id match (was LIKE prefix); throws on unconfirmed/double-revert; records `reverted_at`; does NOT reverse redirects (documented)
- `brain-server/src/api/handlers/index.ts` — 4 new HTTP routes (candidates list, confirm, reject, revert) with 404 on unknown mergeId, 400 on other errors

## Tests
- Normal path: `merge-redirect.test.ts` (23 tests) — `confirmMerge`: relationship redirect (source + target), assertion redirect (subject + object, including mirror assertions), FTS/vec drop, soft-hide alias, audit row with stable id + 4 counts, `confirmed_at`/`reviewed_at` on candidate
- Failure path: `merge-redirect.test.ts` — `confirmMerge` throws on duplicate confirm, throws on null `candidate_entity_id`, throws on self-merge; `revertMerge`: exact audit id match, throws on unconfirmed merge, throws on double revert, handles non-numeric mergeId (stress test for old LIKE-based lookup); `rejectMerge`: status flip, no audit row, no redirects, throws on duplicate reject
- HTTP endpoints: `merge-redirect.test.ts` — candidates list, full confirm→revert lifecycle, 404 on unknown mergeId, status filter fallback
- Run: `cd brain-server && npx vitest run tests/merge-redirect.test.ts`

## Remaining Risk
- `revertMerge` does NOT reverse relationship/assertion redirects — once edges are folded onto canonical, the canonical may have accumulated its own new edges, and undoing the redirect would require per-edge provenance tracking (out of scope for v3). The restored alias is visible again and can accumulate new edges going forward.
- No MCP tool exposes the merge queue — only HTTP routes. stdio MCP clients cannot list/confirm/reject/revert merges.
- The 4 redirect counts in the audit are integers — no per-edge detail of which specific relationships/assertions were redirected.
