# 11 — Task 10: Decision Lineage UI with Relation Type Selector

**Commit**: `5c242e8`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
`GraphViewer.tsx`'s `saveDecision` only sent `previous_decision_id`, auto-linking every subsequent decision as a "continues" without user confirmation. The full-featured `useDecisionContext` hook (with `supersedes_decision_id`, `lineage_relation`, and all 5 relation types) was dead code — never imported by any component. This violated the spec requirement that the user must confirm the lineage relation, and that semantic similarity can only suggest, not auto-save.

## Production Entry Point
`desktop-daemon/src/components/GraphViewer.tsx` → `saveDecision()` → `POST /api/mcp/tool/save_decision`

Backend (already supported, only UI was missing): `save_decision` in `mcp-server.ts` and `mcp.ts`.

## Call Chain
1. User creates a decision in the GraphViewer while a previous decision exists in the session (`lastDecisionIdRef.current` is set)
2. Lineage relation selector dropdown appears (visible only when there's a previous decision)
3. User selects a relation type: `continues` | `revises` | `supersedes` | `reverses` | `invalidates` | `none` (default: `continues`)
4. `saveDecision()` sends full lineage fields based on selection:
   - `supersedes` → `supersedes_decision_id` + `lineage_relation: 'supersedes'`
   - other relations → `previous_decision_id` + `lineage_relation`
   - `none` → no lineage fields (standalone decision)
5. Backend `save_decision` handler creates lineage relationship via `getRecursiveDecisionLineage()` BFS traversal

## Modified Files
- `desktop-daemon/src/components/GraphViewer.tsx`:
  - Added `lineageRelation` state (`'continues' | 'revises' | 'supersedes' | 'reverses' | 'invalidates' | 'none'`, default `'continues'`)
  - `saveDecision` now sends full lineage fields based on user selection
  - Added lineage relation selector dropdown in the save-decision UI (visible only when `lastDecisionIdRef.current` is set)
  - Default `'continues'` preserves existing chain behavior when user doesn't explicitly choose
- `desktop-daemon/src/locales/en.ts` — added localization keys for all 6 relation types
- `desktop-daemon/src/locales/zh.ts` — added localization keys for all 6 relation types

## Tests
- Normal path: `decision-system.test.ts` — `save_decision` with `lineage_relation: 'supersedes'` creates `supersedes` relationship; `save_decision` with `previous_decision_id` + `lineage_relation: 'continues'` creates `continues` relationship; `getRecursiveDecisionLineage()` BFS traversal returns correct chain
- Failure path: `decision-system.test.ts` — `save_decision` without lineage fields creates standalone decision (no lineage relationship); invalid `lineage_relation` value rejected by Zod schema
- Note: Frontend UI changes are verified by TypeScript compilation (compiles cleanly). Brain-server tests unaffected (177 pass).
- Run: `cd brain-server && npx vitest run tests/decision-system.test.ts`

## Remaining Risk
- The lineage selector only appears when `lastDecisionIdRef.current` is set — if the session state is lost (e.g., page refresh), the user can't link to a previous decision without re-selecting it.
- `reverses` and `invalidates` create lineage relationships but don't automatically invalidate the reversed/invalidated decision — they're semantic labels only.
- No visual preview of the lineage chain in the UI before saving — the user selects a relation type blind.
