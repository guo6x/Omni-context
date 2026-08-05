# Unified MCP Business Dispatch Design (统一业务 Dispatch 层设计)

## 1. Problem (问题)

Before this change the repository had **two independent implementations of the same
MCP business tools**:

| Path | Transport | Implementation |
|---|---|---|
| `brain-server/src/mcp-server.ts` | stdio MCP (direct spawn) | 23 tools, rich retrieval (config/temporal/fusion) but **no** evidence groups and **no** `delete_entity` / `merge_entities` / `set_core_principle` |
| `brain-server/src/api/handlers/mcp.ts` | HTTP (`/api/mcp/tool/:name`, `/mcp` JSON-RPC) | 26 tools, hybrid evidence retrieval (`candidatePool` / `finalContext`) |
| `brain-server/src/mcp-proxy.ts` | stdio -> HTTP proxy | thin forwarding (protocol only, unchanged) |

The same tool name therefore behaved differently depending on the transport:

- `unified_memory_search` returned `{results, graphContext, assertions, searchMethods}`
  on stdio but `{results, evidence, candidatePool, finalContext, ...}` on HTTP.
- Three maintenance tools were HTTP-only.
- Retrieval semantics (LLM rerank, evidence selection, topic sedimentation) diverged.

## 2. Target architecture (目标架构)

```
                        ┌────────────────────────────────────┐
                        │  mcp/business-dispatch.ts           │
                        │  McpBusinessDispatcher              │
                        │  - callTool(name, args) -> plain    │
                        │    business data                    │
                        │  - listTools / listResources /      │
                        │    readResource                     │
                        │  - retrieval / memory / decision /  │
                        │    write semantics (single impl)    │
                        └──────────────┬─────────────────────┘
                          ▲            │            ▲
          stdio adapter   │            │            │  HTTP adapter
          mcp-server.ts   │            │            │  api/handlers/mcp.ts
          (transport/     │            │            │  (routing/auth/logging/
           framing/error) │            │            │   error translation)
                          │            │            │
                 [MCP client]    [proxy]       [browser/mobile/desktop]
```

### 2.1 Business layer (`mcp/business-dispatch.ts`)

- `McpBusinessDispatcher` holds `DispatchCtx = { db, extractor, embeddingService,
  archivalMemory, decayScheduler, agentLoop }`.
- `callTool(name, args)` implements **all 26 tools** with a single canonical
  implementation (the union of both old paths, based on the richer HTTP semantics):
  - Hybrid evidence retrieval with `candidatePool` / `finalContext` / evidence groups.
  - LLM rerank (`rerankByLlm`) with deterministic degradation.
  - Focus-stack topic sedimentation in `graph_answer`.
  - Temporal-aware retrieval, reciprocal-rank fusion, raw-event channel isolation.
  - `delete_entity`, `merge_entities`, `set_core_principle`.
- Returns **plain business data** (no protocol wrapping). Errors are thrown as
  `BusinessError` with stable codes (`INVALID_PARAMS`, `NOT_FOUND`,
  `METHOD_NOT_FOUND`, `LLM_NOT_CONFIGURED`, `LLM_ANALYSIS_FAILED`,
  `LLM_OUTPUT_INVALID_JSON`, `LLM_OUTPUT_INVALID`, `EVALUATION_EMBEDDING_UNAVAILABLE`,
  `INTERNAL`).
- `listResources` / `readResource` return plain data too.

### 2.2 Protocol adapters (协议适配层)

| Concern | stdio adapter (`mcp-server.ts`) | HTTP adapter (`api/handlers/mcp.ts`) |
|---|---|---|
| Transport | MCP SDK + `StdioServerTransport` | REST `/api/mcp/tool/:name` + JSON-RPC `/mcp` |
| Success payload | `formatToolResult(data)` = `{content:[{type:'text',text}]}` | REST: plain JSON; JSON-RPC: `rpcResult(id, formatToolResult(data))` |
| Resource payload | `formatResourceResult(uri, data)` | REST: `{contents:[...]}` |
| Errors | `BusinessError` -> `McpError` (InvalidParams/InvalidRequest/MethodNotFound/InternalError) | `businessErrorToHttpStatus` -> 400/404/500/503 |
| Auth / scope | n/a (local stdio) | `AuthService` + `scopeForMcpTool` (JSON-RPC) |
| Logging | n/a | `addMcpUsageLog`, behavior events, matched-entity extraction |

`mcp-proxy.ts` remains a thin stdio->HTTP forwarder (already protocol-only).

### 2.3 Shared formatters (`mcp/errors.ts`)

- `formatToolResult(data)` — the single serialization used by **both** adapters so a
  given business result yields byte-identical payloads.
- `businessErrorToHttpStatus(code)` — HTTP status mapping.
- `BusinessError` — the only error type the business layer throws.

## 3. Guarantees (保证)

1. **Same input -> same business result**: both transports call the same
   `dispatcher.callTool`. Proven by contract tests (`tests/contract-mcp.test.ts`):
   - Tool parity: all advertised tools are implemented (no silent
     `METHOD_NOT_FOUND`).
   - Determinism: repeated calls return identical results (modulo `access_count`,
     which is an intentional implicit-access side effect).
   - Adapter payload equivalence: stdio `formatToolResult` === HTTP `formatToolResult`
     for the same data.
   - HTTP endpoint contract: `/api/mcp/tool/:name` body === dispatcher result.
   - Write semantics shared: writes via HTTP are read back through the dispatcher and
     vice versa.
2. **Auth/logging/error translation stay in the protocol layer** (HTTP adapter).
3. **Retrieval/memory/decision/write semantics are single-source** in the dispatcher.

## 4. What changed (变更清单)

- `brain-server/src/mcp/dispatch.ts` (new) — canonical business dispatch (26 tools,
  evidence retrieval, rerank, sediment, temporal/fusion).
- `brain-server/src/mcp/errors.ts` (new) — `BusinessError`, shared formatters, HTTP
  status mapping.
- `brain-server/src/mcp-server.ts` — reduced from ~1.9k lines to a thin stdio adapter
  (keeps dual-mode embedded HTTP startup).
- `brain-server/src/api/handlers/mcp.ts` — reduced from ~2.5k lines to a thin HTTP
  adapter (keeps `/mcp` JSON-RPC, usage log, behavior events, scope checks).
- `brain-server/src/api/routes.ts` — `RequestContext` gains `mcpDispatcher`; the
  dispatcher is created once per `ApiRouter` and shared with the stdio process when
  `mcp-server.ts` passes its own instance.
- `brain-server/tests/contract-mcp.test.ts` (new) — contract tests.

## 5. Verification (验证)

- `npm run build` (tsc) — clean.
- `npx vitest run` — **337/337 tests pass across 37 files**, including the full
  `api.smoke.test.ts` suite that exercises the canonical HTTP evidence semantics.
- Contract suite: 8/8 pass.

## 6. Known trade-offs (取舍)

- The unified implementation is based on the HTTP path's richer semantics; the stdio
  direct path now returns the same richer shape (e.g., `unified_memory_search` includes
  `candidatePool` / `finalContext`). This is a deliberate unification, not a regression:
  it is what production clients already consumed via `mcp-proxy.ts`.
- `access_count` increments remain a business side effect; contract tests normalize it.
