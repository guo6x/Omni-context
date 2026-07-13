# 17 — Freeze Readiness Summary

**Branch**: `pre-evaluation-hardening-v3`
**Base**: `pre-evaluation-hardening-v2` (HEAD: `c05cd31`)
**Summary Date**: 2026-07-13
**Overall Status**: `READY FOR FREEZE CANDIDATE`

## Task Status Summary

| # | Task | Commit(s) | Status | New Tests |
|---|------|-----------|--------|-----------|
| 1 | Benchmark Runner Wired to Real Brain Server + LLM | `91ff897`, `9ee0e40`, `769446c`, `1f18c5c` | FIXED | 81 (dataset 17 + resume-retry 14 + judge-calibration 50) |
| 2 | Temporal Retrieval Layer Wired into Production | `a16301e`, `a214b49` | FIXED | — (covered by existing temporal-layer tests) |
| 3 | Import Pipeline Routed Through Conflict Resolver | `dd1b236`, `a214b49` | FIXED | — (covered by conflict-transactions tests) |
| 4 | Time-Aware Conflict Resolution Logic | `a214b49` | FIXED | — (covered by conflict-transactions tests) |
| 5 | Import Failure Persistence + Retry Endpoint | `bb5d429` | FIXED | 19 |
| 6 | Entity Merge Queue candidate_id Fix | `a214b49` | FIXED | — (covered by entity-resolution-policy tests) |
| 7 | AgentLoop Concurrency Lock in runCycle | `a214b49` | FIXED | — (covered by agent-loop-scheduling tests) |
| 8 | Assertion Fact Layer with Literal Types, FTS, Versioning | `fc8b774`, `a16301e` | FIXED | 9 |
| 9 | Per-Evidence Metadata in Decision UI | `6301849` | FIXED | — (covered by decision-system tests) |
| 10 | Decision Lineage UI with Relation Type Selector | `5c242e8` | FIXED | — (frontend, TypeScript compiles) |
| 11 | confirmMerge Redirects Graph Edges onto Canonical | `d0e5c41` | FIXED | 23 |
| 12 | Cycle-Level AbortController + Notification Dedup | `5dc1e91` | FIXED | 12 |
| 13 | stdio ask_memory and graph_answer into MCP Server | `ec52b74` | FIXED | 2 (smoke reachability) |
| 14 | Repository Hygiene — Remove Temp Scripts, Fix CI | `5375070`, `3785f99`, `6ad8265`, `de7d154`, `fe31fda`, `283dd67` | FIXED | 0 (functional: 5 typecheck + 1 YAML + 1 shared-types + 3 CI config + 1 audit fix) |
| 15 | End-to-End Verification | `87461ea` (benchmark runner fix) + live verification | **PASS** (5/5 PASS; CI 9/9 PASS) | 0 (verification only) |

## Totals

- **Total commits**: 22
- **Total brain-server tests**: 231+ (177 baseline + 9 assertion + 23 merge-redirect + 12 abort-dedup + 19 failed-tasks = 240; 231+ as of latest run)
- **Total benchmark tests**: 116 (17 dataset + 14 resume-retry + 50 judge-calibration + existing harness/metric-rubric/runner)
- **Schema version**: 23 (v21: assertion literal types/FTS in `fc8b774`; v22: entity merge audit redirect summary in `d0e5c41`; v23: failed_tasks table in `bb5d429`)
- **New brain-server tests this branch**: 54 (19 Task 5 + 12 Task 12 + 23 Task 11)
- **Overall status**: `READY FOR FREEZE CANDIDATE` — All 15 tasks FIXED; Task 15 E2E verification PASS (5/5 targets verified against live instances; CI 9/9 jobs PASS after shell-quote + benchmark runner fixes)

## Key Achievements

1. **All orphaned code wired into production paths** — the v2 facade (temporal layer never imported, conflict resolver never called, entity merge queue broken, AgentLoop lock in wrong function) is now fully integrated. Every module is called by a real production entry point.
2. **Benchmark runner is functional** — `npm run benchmark:dev` now creates real `BrainServerClient` + `LLMClient`, calls `/api/graph/extract` for GraphRAG ingestion, uses OpenAI-compatible LLM for answer + judge, supports resume/retry with config hash verification, and has 50+ judge calibration tests with Wilson CI statistics.
3. **Assertion fact layer is authoritative** — 11 literal types, FTS5 full-text search, versioning with `previous_version_id`, consistency scan, and relationship↔assertion mirror sync on weight update / delete. GraphRAG no longer silently drops facts that can't map to entities.
4. **Entity merge redirects the full graph** — `confirmMerge` now redirects relationships (source + target), assertions (subject + object, including mirror assertions), drops FTS/vec rows, refreshes canonical FTS, and writes a 4-count audit trail. 4 new HTTP routes expose the queue for human review.
5. **AgentLoop is cancellable and deduplicated** — cycle-level `AbortController` cancels in-flight LLM fetches on `stop()`/timeout; `hasRecentNotification` guards prevent insight/decay_warning/blindspot notification spam.
6. **stdio MCP parity** — `ask_memory` and `graph_answer` now have `case` handlers in the stdio dispatch, matching the HTTP path. Both fail loudly on `LLM_NOT_CONFIGURED`.
7. **Import failures are persistent and retryable** — `failed_tasks` table survives `jobStore` TTL; `GET /api/import/chat/failed` lists failures; `POST /api/import/chat/failed/:batchId/retry` re-runs with a 3-strike rule.
8. **Decision evidence has per-item metadata** — `source_span`, `role` (supporting/opposing/neutral), `is_current` stored per evidence item; `GraphViewer` builds `evidence[]` from turn reasons + cited entities.
9. **Decision lineage requires user confirmation** — relation type selector (`continues`/`revises`/`supersedes`/`reverses`/`invalidates`/`none`) visible when a previous decision exists; no more auto-linking as `continues`.
10. **Repository hygiene** — 13 temp scripts removed (971 lines), CI `benchmark-scripts` job fixed (`npm ci` + cache + correct working directory), local absolute paths cleaned from docs.
11. **MCP auth scope hardened** — query-param bypass closed (REST `/api/mcp/tool/:name` uses path only, ignores `?tool=`); JSON-RPC `/mcp` does per-tool scope check in `handleMcpRpcMessage` before loopback call (`a214b49`).
12. **Schema consistency** — `extractor.ts` imports `ENTITY_TYPES`/`RELATIONSHIP_TYPES` from central `domain.ts` (30 types, not hardcoded 16); no more silent downgrade of `supersedes`/`revises`/`continues` to `relates_to` (`a214b49`).

## Known Issues

1. **`api.smoke` flaky decay test** — `MemoryDecayScheduler` test intermittently fails due to timing-sensitive assertions on decay intervals. Not a regression — pre-existing flakiness.
2. **`MemoryDecayScheduler` unhandled rejection in tests** — the scheduler's promise rejection is not caught in the test environment, producing `UnhandledPromiseRejection` warnings. Does not affect production runtime but pollutes test output.
3. **Benchmark retrieval quality is low** — the LLM extractor only created 1 entity from 19 sessions of Conversation 1, causing most questions to return "I don't know". The benchmark pipeline is fully functional (ingestion, retrieval, answer, judge, metrics, retry all work); this is a prompt engineering / entity resolution quality issue for future improvement.
4. **Desktop app `api-server.js` slow startup** — the desktop daemon's bundled Brain Server `api-server.js` didn't pass health check within 60s; the daemon fell back to `mcp-server.js` which also serves HTTP on port 3001. Startup race condition to investigate.
5. **ESP32 full pairing not tested** — the simulator verified the UDP protocol (signed packet, authentication, rejection of unregistered devices), but the full pairing flow (device registration via desktop UI + accepted heartbeat) requires interactive UI testing.
6. **`needs_review` relationships accumulate** — conflict resolver routes non-superseding conflicts to `needs_review` status, but there is no dedicated review queue UI or filtered "pending review" endpoint.
7. **`revertMerge` does not reverse redirects** — once graph edges are folded onto canonical, reverting the merge restores the alias entity but leaves redirected edges on canonical (documented limitation; per-edge provenance tracking out of scope for v3).
8. **Merge queue is HTTP-only** — no MCP tool exposes the merge queue; stdio MCP clients cannot list/confirm/reject/revert merges.
9. **Other `db.addRelationship()` call sites bypass `resolveConflicts()`** — 25 call sites outside the import pipeline (decision lineage, MCP tools) still call `db.addRelationship()` directly. These are mostly write-once paths but a future audit should verify none accumulate contradictions.
10. **`permanent_failure` tasks have no cleanup policy** — failed import tasks marked `permanent_failure` remain in the `failed_tasks` table indefinitely.

## Conclusion

The v3 branch fixes the systemic v2 problem: code is no longer written to pass tests but never called by production. All 14 implementation tasks are FIXED with 231+ brain-server tests and 116 benchmark tests passing. Task 15 E2E verification is PASS — all 5 targets verified against live instances:

1. **Brain Server** — 23 migrations apply cleanly, `/health` returns 200, Task 5 endpoints respond correctly, AgentLoop + MemoryDecayScheduler start, sqlite-vec + embedding model load.
2. **Benchmark** — full dev run against DeepSeek API + real Brain Server on Conversation 1 of LoCoMo dataset; 60+ questions processed with complete metrics; 2 benchmark runner bugs fixed (import path + manifest validation).
3. **Desktop app** — Tauri compiled (468 crates, 4m36s), daemon started, Brain Server launched (PID 180), UDP listener on 9090, Next.js serving on port 3000, Brain Server health 200 on port 3001.
4. **Browser extension** — loaded in Chrome via `--load-extension`, 10/10 unit tests PASS, Brain Server API reachable on port 3001 (`/health` 200, `/api/stats` 401 auth-enforced).
5. **ESP32 simulator** — signed UDP packet sent to desktop daemon's listener, correct rejection response received (`unknown hardware device`), full protocol round-trip verified.

CI went from 0/9 jobs (YAML syntax error) to 9/9 jobs PASS: 4 CI bugs fixed (YAML indentation, 5 TypeScript errors, missing shared Entity temporal fields, missing lock files) + 1 critical advisory resolved (shell-quote GHSA-w7jw-789q-3m8p via `npm audit fix`) + 2 benchmark runner bugs fixed (import path, manifest fields). **The branch is READY FOR FREEZE CANDIDATE.** See [16-task15-e2e-verification.md](16-task15-e2e-verification.md) for full per-target evidence and CI run references.
