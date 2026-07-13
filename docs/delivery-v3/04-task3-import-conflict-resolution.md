# 04 — Task 3: Import Pipeline Routed Through Conflict Resolver

**Commits**: `dd1b236`, `a214b49`
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
`importWithResolution()` in `chat-export.ts` was correctly implemented but **never called** by any file. The real import path (`api/handlers/ingest.ts:573`) called `ctx.db.addRelationship(r)` directly, bypassing `resolveConflicts()` entirely. Of 26 call sites of `db.addRelationship()` across the codebase, only 1 went through `resolveConflicts()`. This meant single-valued predicates (e.g., `lives_in`, `works_at`) accumulated contradictory values instead of superseding old ones.

## Production Entry Point
`POST /api/import/chat` → `runImportPipeline()` in `brain-server/src/api/handlers/ingest.ts`

Also wired into: `POST /api/ingest` (index.ts handler) and `mcp-server.ts` stdio ingest path.

## Call Chain
1. User uploads a chat export via the desktop daemon or HTTP API
2. `POST /api/import/chat` → handler parses conversations
3. `runImportPipeline(jobId, conversations, platform, ctx)`:
   - For each conversation → GraphRAG `extract()` produces entities + relationships
   - `resolveEntities()` deduplicates/merges entities
   - **`resolveConflicts(resolution.relationshipsToCreate, ctx.db, ctx.extractor)`** — relationships now go through the conflict resolver (was direct `db.addRelationship`)
   - `resolveConflicts` internally: queries existing single-valued predicates for same subject+type → calls `checkSingleValueSupersede()` → supersedes or marks `needs_review` → calls `db.addRelationship` + invalidates old + writes audit
4. Import metadata (`batch_id`, `conv_id`, `doc_id`) attached to each relationship for provenance
5. Idempotency check prevents re-importing the same document

## Modified Files
- `brain-server/src/api/handlers/ingest.ts` — `runImportPipeline` now calls `resolveConflicts()` instead of `db.addRelationship()` directly; added import metadata (`batch_id`, `conv_id`, `doc_id`); added idempotency check; tracks `conflictFailures[]` and `failedConversations[]`
- `brain-server/src/api/handlers/index.ts` — `/api/ingest` handler routed through `resolveConflicts`
- `brain-server/src/mcp-server.ts` — stdio ingest path routed through `resolveConflicts`
- `brain-server/src/api/handlers/mcp.ts` — MCP tool ingest path routed through `resolveConflicts`
- `brain-server/src/importers/chat-export.ts` — removed dead `importWithResolution()` (zero callers)

## Tests
- Normal path: `conflict-transactions.test.ts` — import through `resolveConflicts` supersedes old single-valued relationships when newer fact arrives
- Failure path: `failed-tasks.test.ts` — conflict resolution failures are persisted to `failed_tasks` table (not swallowed by `console.warn`)
- Run: `cd brain-server && npx vitest run tests/conflict-transactions.test.ts tests/failed-tasks.test.ts`

## Remaining Risk
- The 25 other `db.addRelationship()` call sites outside the import pipeline (e.g., decision lineage, MCP tools) still bypass `resolveConflicts()`. These are mostly write-once paths (decision evidence, entity merge redirects) where conflict resolution is less critical, but a future audit should verify none accumulate contradictions.
- `bf06b02` extended `runImportPipeline` to distinguish `success` / `partial` / `failed` job status based on failure counts.
