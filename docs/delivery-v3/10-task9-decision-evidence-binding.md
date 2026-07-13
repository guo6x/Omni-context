# 10 — Task 9: Per-Evidence Metadata in Decision UI

**Commit**: `6301849`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
The `SaveDecisionSchema` accepted flat `supporting_entity_ids` / `opposing_entity_ids` / `cited_entity_ids` arrays, but had no per-evidence metadata. The `save_decision` handler couldn't distinguish the role of each cited entity at the individual evidence level, couldn't record `source_span` (the text snippet that justified the citation), and couldn't mark whether an entity was `is_current` at decision time. The frontend `GraphViewer.tsx` `saveDecision` didn't build or send per-evidence metadata.

## Production Entry Point
`save_decision` MCP tool → `brain-server/src/api/handlers/mcp.ts` → `POST /api/mcp/tool/save_decision` (HTTP) and `tools/call` `save_decision` (stdio MCP)

Frontend: `desktop-daemon/src/components/GraphViewer.tsx` → `saveDecision()`

## Call Chain
1. User reviews a decision in the GraphViewer, selects supporting/opposing entities
2. `GraphViewer.saveDecision()` builds `evidence[]` array:
   - From `turn.reasons`: each reason becomes evidence with `role: 'supporting'`, `source_span = reason text`
   - From `turn.citedEntityIds`: each cited entity becomes evidence with `role: 'neutral'`
   - `is_current` derived from `entity.valid_until` (null/empty → `true`, else `false`)
3. `POST /api/mcp/tool/save_decision` with `evidence[]` in payload
4. `SaveDecisionSchema.parse()` validates optional `evidence` array: each item `{ entity_id, role: 'supporting'|'opposing'|'neutral', source_span?, is_current? }`
5. `buildDecisionMetadata()` stores the enriched `evidence[]` array alongside the existing flat ID arrays
6. `save_decision` handler uses `evidence[].role` to determine relationship type:
   - `supporting` → `supported_by`
   - `opposing` → `opposed_by`
   - `neutral` → `decision_referenced`
   - Falls back to flat arrays if `evidence[]` is not provided (backward compatible)

## Modified Files
- `brain-server/src/mcp-tools.ts` — added optional `evidence` array to `SaveDecisionSchema` with per-item `{ entity_id, role, source_span?, is_current? }`
- `brain-server/src/api/handlers/mcp.ts` — `save_decision` handler now uses `evidence[].role` to determine relationship type when per-evidence metadata is provided; falls back to flat arrays otherwise
- `brain-server/src/decision/decision-store.ts` — `buildDecisionMetadata` stores the enriched `evidence[]` array alongside existing supporting/opposing/cited ID arrays
- `desktop-daemon/src/components/GraphViewer.tsx` — `saveDecision` builds `evidence[]` from `turn.reasons` (supporting, with `source_span`) and `turn.citedEntityIds` (neutral); derives `is_current` from `entity.valid_until`

## Tests
- Normal path: `decision-system.test.ts` — `save_decision` with `evidence[]` creates correct relationship types (`supported_by`, `opposed_by`, `decision_referenced`); `buildDecisionMetadata` stores enriched evidence array
- Failure path: `decision-system.test.ts` — `save_decision` without `evidence[]` falls back to flat arrays (backward compatible); invalid `role` value rejected by Zod schema
- Run: `cd brain-server && npx vitest run tests/decision-system.test.ts`

## Remaining Risk
- `source_span` is a free-text string — no validation that it actually appears in the source document.
- `is_current` is derived from `valid_until` at save time; if the entity is later invalidated, the stored `is_current: true` becomes stale. No background job updates historical evidence metadata.
- The mobile app and browser extension do not yet build `evidence[]` — only the desktop daemon `GraphViewer` sends per-evidence metadata.
