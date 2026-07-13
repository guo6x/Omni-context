# 06 — Task 5: Import Failure Persistence + Retry Endpoint

**Commit**: `bb5d429` (with precursor `bf06b02`)
**Status**: FIXED
**Date**: 2026-07-13

## Root Cause
`runImportPipeline` swallowed conflict resolution failures with `console.warn` + `continue` — failed conversations vanished when the in-memory `jobStore` hit its TTL, leaving no way to inspect or retry them. There was no `failed_tasks` table, no retry endpoint, and no persistence of failure context (`payload_snapshot`). The `importWithResolution()` / `ImportJobResult` / `withImportProvenance` helpers in `chat-export.ts` were dead code (zero callers).

## Production Entry Point
- List failures: `GET /api/import/chat/failed?batchId=<id>&status=<status>`
- Retry failures: `POST /api/import/chat/failed/:batchId/retry`

Both routes in `brain-server/src/api/handlers/ingest.ts`.

## Call Chain
1. **Failure capture** (during import):
   - `runImportPipeline()` encounters a chat_import extraction failure or conflict_resolution failure
   - Calls `db.recordFailedTask()` → INSERT into `failed_tasks` table with `payload_snapshot`, `task_type` (`chat_import` | `conflict_resolution`), `batch_id`, `status: 'pending'`
   - Job status now distinguishes `success` (0 failures) / `partial` (some failed) / `failed` (all failed)
2. **List failures**:
   - `GET /api/import/chat/failed?batchId=<id>` → `db.getFailedTasks(batchId, status?)` → returns array of failed task records
3. **Retry**:
   - `POST /api/import/chat/failed/:batchId/retry` → `runFailedImportRetry(jobId, batchId, ctx)`
   - Re-runs extraction for `pending` tasks only
   - On success: marks task `resolved`; on 3 consecutive failures: marks `permanent_failure` (3-strike rule)
   - Preserves conflict-loop guard (prevents infinite retry on cyclic conflicts)

## Modified Files
- `brain-server/src/db/sqlite.ts` — Migration 23: added `failed_tasks` table (`id`, `task_type`, `batch_id`, `status`, `payload_snapshot`, `error_message`, `retry_count`, `created_at`, `updated_at`); added `session_id`/`turn_id`/`role`/`idempotency_key` columns on `ingestion_documents`/`ingestion_chunks`; added 4 Database methods: `recordFailedTask`, `getFailedTasks`, `getFailedTask`, `updateFailedTaskStatus`
- `brain-server/src/api/handlers/ingest.ts` — `runImportPipeline` persists both failure paths to `failed_tasks`; added `runFailedImportRetry()`; added `GET /api/import/chat/failed` and `POST /api/import/chat/failed/:batchId/retry` routes
- `brain-server/src/importers/chat-export.ts` — removed dead `importWithResolution()` / `ImportJobResult` / `withImportProvenance` (121 lines deleted — zero callers confirmed by grep)
- `brain-server/tests/api.smoke.test.ts` — `schemaVersion` 22 → 23

## Tests
- Normal path: `failed-tasks.test.ts` — `recordFailedTask` + `getFailedTasks` round-trip; `getFailedTask` by id; `updateFailedTaskStatus` transitions pending → resolved; retry endpoint re-runs pending tasks and marks resolved
- Failure path: `failed-tasks.test.ts` — 3-strike rule marks `permanent_failure` after 3 consecutive failures; conflict-loop guard prevents infinite retry; `GET /api/import/chat/failed` filters by `batchId` and optional `status`; retry endpoint returns 404 on unknown `batchId`
- Schema verification: `failed-tasks.test.ts` — `failed_tasks` table exists with correct columns; `ingestion_documents` has `session_id`/`turn_id`/`role`/`idempotency_key` columns
- Run: `cd brain-server && npx vitest run tests/failed-tasks.test.ts`

## Remaining Risk
- `permanent_failure` tasks remain in the table indefinitely — no cleanup/archival policy.
- `payload_snapshot` is a JSON blob; large conversations could bloat the table. No size limit enforced.
- The retry endpoint is synchronous (`setImmediate` kick-off) — large batches may time out on the HTTP side while the retry runs in the background.
