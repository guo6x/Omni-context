# 03 — Task 2: Temporal Retrieval Layer Wired into Production

**Commits**: `a16301e`, `a214b49`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
`retrieval/temporal-layer.ts` exported 5 functions (`buildTemporalWhere`, `getEntitiesByEffectiveTime`, `getAssertionsByEffectiveTime`, `searchEntitiesWithTemporal`, `resolveTemporalField`) but zero files in `src/` imported them. None of the 9 specified entry points (`unified_memory_search`, `ask_memory`, `graph_answer`, `get_decision_context`, `analyze_decision`, `discuss_decision` — both HTTP and stdio) referenced the temporal layer. Additionally, `asOfFilter` used string interpolation (SQL injection risk).

## Production Entry Point
All 9 answer paths now apply temporal filtering:
- HTTP: `brain-server/src/api/handlers/mcp.ts` — `unified_memory_search`, `ask_memory`, `graph_answer`, `get_decision_context`, `analyze_decision`, `discuss_decision`
- stdio: `brain-server/src/mcp-server.ts` — same 6 tools via JSON-RPC `tools/call`

## Call Chain
1. User asks a time-scoped question (e.g., "where did John live in 2023?")
2. `parseTemporalQuery()` extracts `mode` (`current` | `historical` | `as_of`) and optional `asOf` date
3. `temporalOptsFromQuery()` builds `TemporalQueryOpts` (`includeHistorical`, `asOf`, `limit`)
4. `buildTemporalWhere(opts)` produces a parameter-bound WHERE clause:
   - `current` → `valid_until IS NULL OR valid_until > datetime('now')`
   - `as_of` → `valid_from <= ? AND (valid_until IS NULL OR valid_until > ?)` (parameter-bound, no injection)
   - `historical` → no filter (all rows)
5. `_retrieveMemoryCandidates()` applies the clause to entity + assertion queries
6. Results returned to LLM for grounded answer

## Modified Files
- `brain-server/src/retrieval/temporal-layer.ts` — rewrote `asOfFilter` to use parameter binding (was string interpolation — SQL injection fix); added `parseTemporalQuery`, `temporalOptsFromQuery`; expanded from 5 to full function set with `getEntitiesByEffectiveTime`, `getAssertionsByEffectiveTime`, `searchEntitiesWithTemporal`
- `brain-server/src/api/handlers/mcp.ts` — wired `parseTemporalQuery` + `filterEntitiesByTemporal` into `unified_memory_search`, `ask_memory`, `graph_answer`, `get_decision_context`, `analyze_decision`, `discuss_decision` HTTP handlers
- `brain-server/src/mcp-server.ts` — wired temporal filtering into the stdio `tools/call` dispatch for the same 6 tools
- `brain-server/src/api/handlers/index.ts` — temporal filter applied in retrieval route

## Tests
- Normal path: `temporal-layer.test.ts` — `buildTemporalWhere` for current/historical/as_of modes; `parseTemporalQuery` extracts mode + asOf; `getEntitiesByEffectiveTime` returns only entities active at the specified time
- Failure path: `temporal-layer.test.ts` — `asOfFilter` uses parameter binding (verifies no string interpolation); invalid date handling
- Run: `cd brain-server && npx vitest run tests/temporal-layer.test.ts tests/temporal-assertions.test.ts`

## Remaining Risk
- Temporal parsing depends on the LLM/detector correctly extracting `event_time` / `valid_from` / `valid_until` during GraphRAG extraction. If extraction omits timestamps, `asOf` filtering degrades to `historical` mode.
- `datetime('now')` uses SQLite server time, not UTC-explicit — acceptable for single-server deployment.
