# 07 — Task 6: Entity Merge Queue candidate_id Fix

**Commit**: `a214b49`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
`queueCandidate()` (`entity-resolver.ts:228`) hardcoded `candidate_entity_id` as `NULL` in the INSERT statement. When `confirmMerge()` (line 433) later read `candidate_entity_id` from the DB to perform the merge, it got `NULL`, so `UPDATE entities SET ... WHERE id = NULL` matched zero rows. Additionally, `revertMerge()` (line 475) used `LIKE mergeId + '%'` to find the audit row, but the audit id was `candidateId + '_audit_' + timestamp` — the LIKE prefix could match the wrong row if multiple candidates shared a mergeId prefix. Entities queued for manual merge were never actually mergeable.

## Production Entry Point
`resolveEntities()` in `brain-server/src/graphrag/entity-resolver.ts` — called by GraphRAG `extract()` during every ingest path (HTTP `/api/graph/extract`, `/api/ingest`, stdio MCP ingest).

Merge confirmation: `confirmMerge(db, mergeId)` — called by `POST /api/entities/merge/:mergeId/confirm` (added in Task 11, commit `d0e5c41`).

## Call Chain
1. GraphRAG `extract()` produces a batch of entities
2. `resolveEntities(batch, db)` checks each entity against existing entities:
   - Exact name match on `NEVER_AUTO_MERGE_TYPES` (decision, goal, event, etc.) → `db.addEntity(entity)` + `queueCandidate(db, entity, exact, 1, 'exact_name_manual_only')`
   - Exact name match with incompatible context on `CONTEXT_GATED_TYPES` → `db.addEntity(entity)` + `queueCandidate(..., 'exact_name_context_mismatch')`
   - Semantic match with similarity ≥ `REVIEW_SIMILARITY` → `db.addEntity(entity)` + `queueCandidate(..., 'semantic_review_required')`
3. `queueCandidate()` INSERTs into `entity_merge_candidates` with `candidate_entity_id = entity.id` (was `NULL`)
4. `confirmMerge(db, mergeId)` reads `candidate_entity_id` from the candidate row → redirects graph edges onto canonical entity
5. `revertMerge(db, mergeId)` finds audit row by exact id `${mergeId}_audit` (was LIKE prefix)

## Modified Files
- `brain-server/src/graphrag/entity-resolver.ts`:
  - `queueCandidate()`: INSERT now binds `entity.id` as `candidate_entity_id` (was hardcoded `NULL`)
  - `resolveEntities()`: added `queuedEntityIds` Set to track entities added to the queue; these are excluded from the "new entities" batch to avoid double-insertion; `db.addEntity(entity)` called before `queueCandidate` for manual-review candidates
  - `confirmMerge()`: audit id changed to `${mergeId}_audit_${Date.now()}` (stable prefix); INSERT includes `merge_reason`, `similarity`, `snapshot` columns
  - `revertMerge()`: changed candidate status update to target by `id = mergeId` (was `canonical_id = ? AND status = 'confirmed'`); restores candidate to `pending` status with `reviewed_at = NULL` (was `reverted`)

## Tests
- Normal path: `entity-resolution-policy.test.ts` — `queueCandidate` stores correct `candidate_entity_id`; `confirmMerge` reads non-null `candidate_entity_id` and updates the correct entity row
- Failure path: `entity-resolution-policy.test.ts` — `confirmMerge` throws on duplicate confirm; `revertMerge` throws on unconfirmed merge; `revertMerge` restores candidate to `pending` (not `reverted`)
- Run: `cd brain-server && npx vitest run tests/entity-resolution-policy.test.ts`

## Remaining Risk
- `revertMerge` restores the candidate to `pending` but does **not** undo relationship/assertion redirects (once edges are folded onto canonical, they stay). This is documented in the function comment and fully addressed in Task 11 (`d0e5c41`) which rewrites `confirmMerge` to redirect graph edges and `revertMerge` to use exact id match.
- The `queuedEntityIds` guard prevents double-insertion but assumes `resolveEntities` is called once per batch — concurrent calls on the same entity could still double-insert.
