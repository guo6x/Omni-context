# 09 — Task 8: Assertion Fact Layer with Literal Types, FTS, Versioning

**Commits**: `fc8b774`, `a16301e`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
The `assertions` table existed (migration v15) but had no `literal_type` enum, no versioning, no FTS, and no consistency scan. `updateRelationshipWeight` and `deleteRelationship` did not sync mirror assertions. `getRelationshipsForEntity` and `getAssertions` did not filter out `invalidated_at` rows (only checked `valid_until`), causing superseded facts to appear active when `valid_until` was set to a future date. GraphRAG `extractor.ts` converted LLM facts to Relationships only — when an object couldn't map to an entity, the fact was silently dropped (`continue`), so no literal assertions were ever written.

## Production Entry Point
- GraphRAG extraction: `brain-server/src/graphrag/extractor.ts` → `extract()` now outputs an `assertions` array alongside `entities` and `relationships`
- All 6 ingest paths write assertions: `ingest.ts`, `mcp.ts`, `chat-export.ts`, `index.ts`, `mcp-server.ts`
- FTS search: `searchAssertions(query, limit)` — used by `_retrieveMemoryCandidates` in answer paths
- Consistency scan: `consistencyScan()` — available for admin monitoring

## Call Chain
1. GraphRAG `extract()` produces entities, relationships, and now **assertions**:
   - Entity-entity assertions: subject_id + object_id (mirror of relationships)
   - Literal assertions: subject_id + `literal_value` + `literal_type` (when object can't map to an entity — was silently dropped)
2. `addAssertion(db, assertion)`:
   - Writes `literal_type` (CHECK-constrained to 11 types), `version` (default 1), `previous_version_id`
   - Inserts into `fts_assertions` FTS5 virtual table if the assertion is current (not invalidated)
3. `invalidateAssertion()` → removes from `fts_assertions`
4. `invalidateRelationship()` → removes mirror assertion from `fts_assertions`
5. `updateRelationshipWeight()` → syncs mirror assertion confidence from relationship weight (clamped to [0,1])
6. `deleteRelationship()` → invalidates mirror assertion (preserves audit trail) + removes from `fts_assertions`
7. `getRelationshipsForEntity()` / `getGraphNeighborhood()` / `getAssertions()` → add `invalidated_at IS NULL` check when `!includeHistorical`
8. `searchAssertions(query, limit)` → FTS5 MATCH over current assertions
9. `consistencyScan()` → verifies relationship↔assertion mirror integrity + FTS orphan detection (returns 4 counts, zero = consistent)

## Modified Files
- `brain-server/src/shared-types.ts` — added `LITERAL_TYPES` const (11 types: string, number, date, datetime, boolean, currency, location_text, status, quantity, contact, conclusion) and `LiteralType` type
- `brain-server/src/db/sqlite.ts`:
  - Migration 21: `literal_type` column (CHECK-constrained), `version` column (INTEGER NOT NULL DEFAULT 1), `previous_version_id` column, `fts_assertions` FTS5 virtual table, backfill from existing assertions
  - `addAssertion`: writes `literal_type`, `version`, `previous_version_id`, inserts into `fts_assertions`
  - `invalidateAssertion`: removes from `fts_assertions`
  - `invalidateRelationship`: removes mirror assertion from `fts_assertions`
  - `updateRelationshipWeight`: syncs mirror assertion confidence (clamped [0,1])
  - `deleteRelationship`: invalidates mirror assertion + removes from `fts_assertions`
  - `getRelationshipsForEntity`, `getGraphNeighborhood`, `getRelationshipsForEntities`: added `invalidated_at IS NULL` check when `!includeHistorical`
  - `getAssertions`: added `invalidated_at IS NULL` check when `!includeHistorical`; return mapping includes `literal_type`, `version`, `previous_version_id`
  - New `searchAssertions(query, limit)`: FTS5 search over current assertions
  - New `consistencyScan()`: returns 4 counts (relationship without mirror, mirror without relationship, FTS orphan, invalidated in FTS)
- `brain-server/src/graphrag/extractor.ts` — `extract()` now outputs `assertions` array with entity-entity and literal variants; literal assertions written when object can't map to entity (was `continue` — silently dropped)
- `brain-server/src/api/handlers/ingest.ts`, `mcp.ts`, `index.ts`, `mcp-server.ts`, `importers/chat-export.ts` — all 6 ingest paths now write assertions

## Tests
- Normal path: `assertion-fact-layer.test.ts` — all 11 literal types accepted and round-tripped; entity-object + literal assertions coexist on same subject; FTS search returns matching assertions; FTS invalidation on `invalidateAssertion`; weight sync on `updateRelationshipWeight`; consistency scan returns 0/0/0/0 on clean DB
- Failure path: `assertion-fact-layer.test.ts` — `deleteRelationship` invalidates mirror assertion (not hard delete); `getAssertions` excludes `invalidated_at` rows when `!includeHistorical` (fixes superseded facts appearing active); consistency scan detects FTS orphans; versioning chains via `previous_version_id`
- Run: `cd brain-server && npx vitest run tests/assertion-fact-layer.test.ts tests/temporal-assertions.test.ts`

## Remaining Risk
- `consistencyScan()` is available but not scheduled — no periodic check runs it automatically.
- FTS5 virtual table is SQLite-specific; if the DB backend changes, FTS search will need reimplementation.
- The `invalidated_at IS NULL` fix only applies when `!includeHistorical`; callers that pass `includeHistorical: true` still see invalidated rows (by design, but could surprise consumers).
