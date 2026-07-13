# 05 — Task 4: Time-Aware Conflict Resolution Logic

**Commit**: `a214b49`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
`checkSingleValueSupersede()` (`conflict-resolver.ts:248-288`) implemented proper time comparison logic but was **never called**. `resolveConflicts()` (lines 172-177) used unconditional supersession: `single-valued → superseded, confidence=1`. No time comparison, no `temporal_confidence` check, no provenance check. This meant a 2023 fact would supersede a 2024 fact if imported later, and historical imports would auto-supersede live data.

## Production Entry Point
`resolveConflicts()` in `brain-server/src/graphrag/conflict-resolver.ts` — called by `runImportPipeline()` (ingest.ts:623), `/api/ingest` (index.ts), and `mcp-server.ts` stdio ingest.

## Call Chain
1. Import pipeline calls `resolveConflicts(relationshipsToCreate, db, extractor)`
2. For each incoming relationship, queries existing relationships with same `source_id` + `type` that are single-valued predicates (`works_at`, `lives_in`, `studies_at`, `married_to`, etc.)
3. For each conflicting old relationship, calls `checkSingleValueSupersede(old, incoming)`:
   - Checks `SINGLE_VALUED_PREDICATES` set membership
   - Compares `existing.event_time || existing.valid_from` vs `incoming.event_time || incoming.valid_from`
   - If incoming has no time but existing does → `shouldSupersede: false` (action: `review`)
   - If incoming is earlier than existing → `shouldSupersede: false` (action: `review`)
   - If `incoming.temporal_confidence < 0.7` → `shouldSupersede: false` (action: `review`)
   - If `provenance.source === 'history_import'` → `shouldSupersede: false` (action: `review`)
   - Otherwise → `shouldSupersede: true` (action: `supersede`)
4. If `shouldSupersede`: old relationship invalidated (`valid_until` set), new relationship written with audit
5. If not: old relationship marked `needs_review` (confidence 0.5) — human review required

## Modified Files
- `brain-server/src/graphrag/conflict-resolver.ts`:
  - `resolveConflicts()` now iterates single-valued conflicts through `checkSingleValueSupersede()` (was unconditional `status: 'superseded', confidence: 1`)
  - Added `needs_review` status to `PlannedResolution` union
  - `checkSingleValueSupersede()` now returns `confidence` field; all return paths populate it
  - Supersede confidence = `incoming.temporal_confidence ?? 1`; review confidence = `0.5`

## Tests
- Normal path: `conflict-transactions.test.ts` — newer fact supersedes older fact for same single-valued predicate; `temporal_confidence >= 0.7` allows supersession
- Failure path: `conflict-transactions.test.ts` — incoming fact with no time cannot supersede existing fact with time; incoming fact earlier than existing cannot supersede; `temporal_confidence < 0.7` blocks supersession; `history_import` provenance blocks auto-supersession (routes to `needs_review`)
- Run: `cd brain-server && npx vitest run tests/conflict-transactions.test.ts`

## Remaining Risk
- `needs_review` relationships accumulate in the DB with no dedicated review queue UI. They are visible via `getRelationshipsForEntity(includeHistorical: true)` but there is no filtered "pending review" endpoint.
- Only single-valued predicates are time-checked; multi-valued predicates (e.g., `relates_to`, `cites`) still use semantic resolution via `planSemanticResolutions()`.
