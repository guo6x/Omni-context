# 14 — Task 13: stdio ask_memory and graph_answer Wired into MCP Server

**Commit**: `ec52b74`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
The stdio MCP server (`mcp-server.ts`) was missing `case` handlers for `ask_memory` and `graph_answer` — tools declared in `mcp-tools.ts` but falling through to `MethodNotFound` in the stdio dispatch switch. This meant stdio MCP clients (Claude Desktop, etc.) could not use the two core Q&A tools, breaking parity with the HTTP path. The HTTP `/api/mcp/tool/ask_memory` and `/api/mcp/tool/graph_answer` routes worked, but stdio clients got `MethodNotFound`.

## Production Entry Point
`brain-server/src/mcp-server.ts` → stdio JSON-RPC `tools/call` dispatch → `case 'ask_memory'` and `case 'graph_answer'`

## Call Chain
1. stdio MCP client (e.g., Claude Desktop) sends `tools/call` with `name: 'ask_memory'` or `name: 'graph_answer'`
2. `mcp-server.ts` `tools/call` dispatch:
   - **`ask_memory`**: `_retrieveMemoryCandidates(messages, temporalOpts)` (temporal-aware) → builds memory/principle blocks → calls LLM with grounding → returns `{ reply, sources, assertions }`
   - **`graph_answer`**: `_retrieveMemoryCandidates()` → builds sub-graph edges with temporal filtering (excludes invalidated relationships in current mode) → calls LLM for structured JSON output → returns `{ conclusion, reasons, sources, edges, citedEntityIds, assertions }`
3. Both handlers use `temporalOptsFromQuery` for time-aware filtering
4. Both handlers return `assertions` alongside entities (Assertions enter the ranked candidate pool, not a side array)
5. Both handlers fail loudly on `LLM_NOT_CONFIGURED` instead of silent fallback

## Modified Files
- `brain-server/src/mcp-server.ts`:
  - Added `case 'ask_memory'`: retrieves memory candidates via `_retrieveMemoryCandidates` (temporal-aware), builds memory/principle blocks, calls LLM with grounding, returns `reply + sources + assertions`
  - Added `case 'graph_answer'`: retrieves candidates, builds sub-graph edges with temporal filtering (excludes invalidated relationships in current mode), calls LLM for structured JSON output, returns `conclusion + reasons + sources + edges + citedEntityIds + assertions`
  - Both handlers use `temporalOptsFromQuery` for time-aware filtering
  - Both handlers return assertions alongside entities
  - Both handlers fail loudly on `LLM_NOT_CONFIGURED` instead of silent fallback
- `brain-server/tests/api.smoke.test.ts` — 2 new HTTP smoke tests verifying `ask_memory` and `graph_answer` are reachable (not 404/MethodNotFound)

## Tests
- Normal path: `api.smoke.test.ts` — `ask_memory` HTTP endpoint returns 200 (not 404/MethodNotFound); `graph_answer` HTTP endpoint returns 200 (not 404/MethodNotFound)
- Failure path: `api.smoke.test.ts` — `LLM_NOT_CONFIGURED` returns error (not silent fallback with "unknown")
- Run: `cd brain-server && npx vitest run tests/api.smoke.test.ts`

## Remaining Risk
- The smoke tests verify reachability but do not validate the full LLM-grounded answer quality — that requires a live LLM (pending Task 15 E2E verification).
- stdio parity is now complete for `ask_memory` and `graph_answer`, but other MCP tools may still lack stdio handlers — a full parity audit is recommended.
- `LLM_NOT_CONFIGURED` fails loudly, which is correct for production but could break stdio clients that don't handle the error gracefully.
