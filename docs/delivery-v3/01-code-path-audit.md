# 01 — Code Path Audit

**Branch**: `pre-evaluation-hardening-v3`
**Base**: `pre-evaluation-hardening-v2` (HEAD: `c05cd31`)
**Audit Date**: 2026-07-13
**Auditor**: Trae AI (automated)

## Methodology

Every claim in the v2 delivery report ("all 15 P0 FIXED", "229/229 tests pass") is void.
Only evidence from actual source code, call chains, and test execution counts.

## Summary: v2 is a facade

v2 added 39 files across 11 commits, but the majority of new code is **orphaned** — defined but never called by any production entry point. The benchmark runner cannot run. The temporal layer is dead code. The entity merge queue is broken. The AgentLoop lock is in the wrong function.

## Detailed Findings

### 1. Benchmark Runner — NON-FUNCTIONAL SCAFFOLD

**Status**: BLOCKED

| Component | Claimed | Actual |
|---|---|---|
| `npm run benchmark:dev` | Works | `brainServerFactory` throws `Error("Brain server factory not configured")` (cli.mjs:78-83) |
| Official locomo10.json support | Yes | `dataset.mjs:7` requires `dataset.conversations` array — official format is a top-level array, incompatible |
| GraphRAG extraction | Yes | `ingestConversationIntoSandbox` (runner:50-85) calls `db.addEntity()` directly — no GraphRAG, no extract, no relationships |
| graph_answer | Yes | Not called. Uses `llmClient.answer()` which is `null` in CLI |
| LLM answer | Yes | `llmClient: null` (cli.mjs:77) → hardcoded `"unknown"` (runner:145-147) |
| Judge | Yes | `llmClient: null` → `rawJudge = null` → `judgeResult = null` (runner:159-162) |
| Embedding | Semantic | `embeddingStatus.available = false` (cli.mjs:64), `assertEvaluationEmbeddingMode` imported but never called |
| Integration tests | Yes | No test calls `runBenchmark()`. All tests are unit tests on utility functions |
| Manifest fields | Tracked | `benchmark_commit`, `brain_server_commit`, `answer_model`, `judge_model` all default to `"unknown"` |

**Root cause**: The runner has a complete call skeleton but every external dependency is a placeholder.

### 2. Temporal Layer — ORPHANED CODE

**Status**: NOT INTEGRATED

`retrieval/temporal-layer.ts` exports 5 functions (`buildTemporalWhere`, `getEntitiesByEffectiveTime`, `getAssertionsByEffectiveTime`, `searchEntitiesWithTemporal`, `resolveTemporalField`).

**Grep result**: Zero imports of `temporal-layer` in the entire `src/` directory. None of the 9 specified entry points (`unified_memory_search`, `ask_memory`, `graph_answer`, `get_decision_context`, `analyze_decision`, `discuss_decision` — both HTTP and stdio) reference it.

### 3. Import Pipeline — BYPASSES CONFLICT RESOLVER

**Status**: BROKEN

- `importWithResolution()` (chat-export.ts:280-361) is correctly implemented but **never called** by any file.
- Real import path (`api/handlers/ingest.ts:573`) calls `ctx.db.addRelationship(r)` directly, bypassing `resolveConflicts()`.
- **26 call sites** of `db.addRelationship()` across the codebase, only 1 goes through `resolveConflicts()` (conflict-resolver.ts:187).

### 4. Conflict Resolver — TIME-AWARE LOGIC IS DEAD CODE

**Status**: NOT INTEGRATED

- `checkSingleValueSupersede()` (conflict-resolver.ts:248-288) implements proper time comparison but is **never called**.
- `resolveConflicts()` (line 172-177) still uses unconditional: `single-valued → superseded, confidence=1`
- No time comparison, no temporal_confidence check, no provenance check.

### 5. Entity Merge Queue — DOUBLE FAILURE

**Status**: BROKEN

- `queueCandidate()` (entity-resolver.ts:228) hardcodes `candidate_entity_id` as `NULL` in the INSERT statement.
- `confirmMerge()` (line 433) reads `candidate_entity_id` from DB → gets `NULL` → `UPDATE entities SET ... WHERE id = NULL` → matches zero rows.
- `revertMerge()` (line 475) uses `LIKE mergeId + '%'` but audit.id is `candidateId + '_audit_' + timestamp` → never matches.

### 6. AgentLoop — LOCK IN WRONG FUNCTION

**Status**: BROKEN

- `isCycleRunning = true` (line 193) and `cycleTimeout` (line 194) are inside `stop()`, not `runCycle()`.
- `runCycle()` (line 259) has no lock — no `isCycleRunning = true` at start, no `false` at end, no try/finally.
- Consequence: multiple `runCycle()` instances can run concurrently; `stop()` paradoxically sets the lock.

### 7. Assertion Layer — GRAPHRAG DOESN'T PRODUCE ASSERTIONS

**Status**: PARTIAL

- `assertions` table exists (sqlite.ts migration v15, lines 305-365) with `literal_value` support.
- `addAssertion()` and `getAssertions()` implemented (sqlite.ts:1557-1657).
- **But**: GraphRAG `extractor.ts` converts LLM facts to Relationships only (line 397-432). When object can't map to entity → `continue` (line 401-403) — fact silently dropped.
- No literal assertions are ever written by the GraphRAG pipeline.

### 8. Decision Evidence — NO BINDING

**Status**: NOT IMPLEMENTED

- `analyze_decision` output (mcp.ts:1289-1302): `pros`/`cons` are `string[]`, not `{text, evidence_ids}[]`.
- No `risks` field in output or prompt.
- `evidence` is a separate list with `relevance: 'relevant'` hardcoded for all.
- No Zod schema validation on LLM output — just `JSON.parse`.

### 9. Decision Lineage UI — FRONTEND DOESN'T SEND LINEAGE

**Status**: PARTIAL

- Backend: `SaveDecisionSchema` supports `previous_decision_id`, `supersedes_decision_id`, `lineage_relation` (mcp-tools.ts:114-116).
- Backend: `save_decision` handler creates lineage relationships (mcp.ts:1763-1801).
- Backend: `getRecursiveDecisionLineage()` implements BFS traversal (decision-store.ts:59-106).
- **Frontend**: `useDecisionContext.ts:190-220` `saveDecision()` doesn't send lineage fields.
- `withLineage()` function (line 283-305) is dead code — never imported or called.

### 10. MCP Auth — JSON-RPC SCOPE BROKEN

**Status**: PARTIAL

- REST `/api/mcp/tool/:name`: Has per-tool scope mapping (`MCP_TOOL_SCOPE_MAP`), but `?tool=` query param can override path-based tool name (auth.ts:166) — potential scope downgrade.
- JSON-RPC `/mcp`: `pathname.split('/').pop()` returns `'mcp'` → `scopeForMcpTool('mcp')` returns `null` → falls back to `admin:delete` (auth.ts:170).
- All device tokens (mobile/browser_extension/esp32) lack `admin:delete` scope → **cannot access `/mcp` at all**.
- `tools/call` handler (mcp.ts:750-762) doesn't check per-tool scope — uses `LOCAL_API_TOKEN` with `ALL_SCOPES` via loopback.

### 11. Schema Consistency — 14 RELATIONSHIP TYPES SILENTLY DROPPED

**Status**: BROKEN

- `schema/domain.ts`: 30 relationship types (including `supersedes`, `revises`, `continues`, `opposed_by`, `supported_by`, `outcome_of`, `learned_from`).
- `graphrag/extractor.ts:286-304`: Manual `VALID_RELATIONSHIP_TYPES` with only 16 types.
- `extractor.ts:405-407`: Types not in the 16-set are silently downgraded to `relates_to`.
- LLM prompt tells LLM about 30 types, LLM outputs `supersedes`, extractor downgrades to `relates_to`.
- `llm-pipeline.ts` correctly imports from `domain.ts`, but `extractor.ts` doesn't.

### 12. work/ Directory — 12 TEMPORARY SCRIPTS TRACKED

**Status**: NEEDS CLEANUP

12 one-time patch scripts in `work/` directory are tracked in git:
`batch-fixes.py`, `batch-p013-p04.js`, `fix-final.js`, `fix-last-test.js`, `fix-p08-p04.js`, `fix-provenance.js`, `fix-return.js`, `fix-tests.js`, `fix-ts.js`, `fix3.js`, `p0-batch.js`, `p012.js`, `p05-p06.js`

### 13. GitHub Actions — 7/9 JOBS PASS (NOT 9/9)

v2 commit message: "7/9 jobs pass, 2 pre-existing failures documented"
Security workflow: success.
Cannot verify other jobs due to GitHub API rate limit.

## Conclusion

The v2 branch is **NOT READY FOR FREEZE CANDIDATE**. The fundamental problem is systemic: code was written to pass tests, but not to be called by production entry points. Every module has the same pattern — a correct implementation that is never imported or invoked.
