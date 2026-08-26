import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { createServer } from '../src/api/routes.js';
import { LLMExtractorPipeline } from '../src/graphrag/llm-pipeline.js';
import { testEmbeddingService } from './helpers/test-embedding-service.js';

// Task 5 — failed_tasks persistence + chat import retry.
//
// Before Task 5, runImportPipeline tracked failures only in the in-memory
// jobStore arrays (failedConversations / conflictFailures), which were lost
// after the 5-minute TTL. There was no retry endpoint for chat imports.
// These tests pin the new behavior:
//   1. recordFailedTask / getFailedTasks / updateFailedTaskStatus round-trip
//   2. GET /api/import/chat/failed lists persisted failures
//   3. POST /api/import/chat/failed/:batchId/retry kicks off retry job

let db: Database;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.LOCAL_API_TOKEN = 'test-token-123';

  // Mock LLM extractor so retry path can succeed without a real LLM
  vi.spyOn(LLMExtractorPipeline.prototype, 'extractWithDiagnostics').mockResolvedValue({
    result: {
      entities: [{ name: 'RetryEntity', type: 'concept', description: 'from retry' }],
      facts: [],
      principles: [],
    },
    diagnostics: {
      http_status: 200, raw_response_sha256: 'c'.repeat(64), finish_reason: 'stop', status: 'parsed',
      parsed_counts: { entities: 1, facts: 0, principles: 0 },
      normalization: { entity_types: [], predicates: [] },
    },
  });

  db = initDatabase({ dbPath: ':memory:' });
  await db.runMigrations();
  await db.rebuildAllEmbeddings(testEmbeddingService as any);
  server = createServer(db, undefined, testEmbeddingService as any);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.close();
});

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.LOCAL_API_TOKEN}`,
  };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function waitForIngestJob(jobId: string, timeoutMs = 10_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | undefined;
  let lastHttpStatus: number | undefined;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const response = await request('GET', `/api/ingest/job/${jobId}`);
    lastHttpStatus = response.status;
    lastStatus = response.body?.status;
    if (lastStatus === 'success' || lastStatus === 'failed' || lastStatus === 'partial') {
      return lastStatus;
    }
  }
  throw new Error(`Ingest job ${jobId} did not finish; last HTTP=${lastHttpStatus}, status=${lastStatus}`);
}

describe('Task 5: failed_tasks Database methods', () => {
  beforeEach(async () => {
    // Clean slate between DB-level tests
    await db.run("DELETE FROM failed_tasks WHERE batch_id LIKE 'test-%'");
  });

  it('recordFailedTask inserts a row with status=pending and attempts=0', async () => {
    await db.recordFailedTask({
      task_id: 'test-task-1',
      batch_id: 'test-batch-1',
      task_type: 'chat_import',
      conversation_title: 'Failed Conversation A',
      stage: 'extracting',
      error: 'LLM timeout',
      payload_snapshot: JSON.stringify({ title: 'Failed Conversation A', text: 'hello' }),
    });

    const task = await db.getFailedTask('test-task-1');
    expect(task).not.toBeNull();
    expect(task!.batch_id).toBe('test-batch-1');
    expect(task!.task_type).toBe('chat_import');
    expect(task!.conversation_title).toBe('Failed Conversation A');
    expect(task!.error).toBe('LLM timeout');
    expect(task!.status).toBe('pending');
    expect(task!.attempts).toBe(0);
  });

  it('getFailedTasks filters by batch_id and optional status', async () => {
    await db.recordFailedTask({
      task_id: 'test-task-2',
      batch_id: 'test-batch-2',
      task_type: 'chat_import',
      error: 'error 1',
    });
    await db.recordFailedTask({
      task_id: 'test-task-3',
      batch_id: 'test-batch-2',
      task_type: 'conflict_resolution',
      error: 'error 2',
    });
    await db.recordFailedTask({
      task_id: 'test-task-4',
      batch_id: 'test-batch-other',
      task_type: 'chat_import',
      error: 'error 3',
    });

    const all = await db.getFailedTasks('test-batch-2');
    expect(all.length).toBe(2);

    const pending = await db.getFailedTasks('test-batch-2', 'pending');
    expect(pending.length).toBe(2);
    expect(pending.every((t) => t.status === 'pending')).toBe(true);
  });

  it('updateFailedTaskStatus transitions pending → retrying (increments attempts)', async () => {
    await db.recordFailedTask({
      task_id: 'test-task-5',
      batch_id: 'test-batch-3',
      task_type: 'chat_import',
      error: 'initial error',
    });

    await db.updateFailedTaskStatus('test-task-5', 'retrying');
    let task = await db.getFailedTask('test-task-5');
    expect(task!.status).toBe('retrying');
    expect(task!.attempts).toBe(1);

    await db.updateFailedTaskStatus('test-task-5', 'retrying');
    task = await db.getFailedTask('test-task-5');
    expect(task!.attempts).toBe(2);
  });

  it('updateFailedTaskStatus transitions to resolved without incrementing attempts', async () => {
    await db.recordFailedTask({
      task_id: 'test-task-6',
      batch_id: 'test-batch-4',
      task_type: 'chat_import',
      error: 'error',
    });
    await db.updateFailedTaskStatus('test-task-6', 'retrying');
    await db.updateFailedTaskStatus('test-task-6', 'resolved');

    const task = await db.getFailedTask('test-task-6');
    expect(task!.status).toBe('resolved');
    expect(task!.attempts).toBe(1); // only retrying incremented
  });

  it('updateFailedTaskStatus to permanent_failure appends error', async () => {
    await db.recordFailedTask({
      task_id: 'test-task-7',
      batch_id: 'test-batch-5',
      task_type: 'chat_import',
      error: 'original error',
    });

    await db.updateFailedTaskStatus('test-task-7', 'permanent_failure', 'gave up after 3 tries');

    const task = await db.getFailedTask('test-task-7');
    expect(task!.status).toBe('permanent_failure');
    expect(task!.error).toContain('gave up after 3 tries');
  });

  it('getFailedTask returns null for non-existent task', async () => {
    const task = await db.getFailedTask('nonexistent-task-id');
    expect(task).toBeNull();
  });

  it('recordFailedTask uses INSERT OR REPLACE (idempotent on same task_id)', async () => {
    await db.recordFailedTask({
      task_id: 'test-task-8',
      batch_id: 'test-batch-6',
      task_type: 'chat_import',
      error: 'first error',
    });
    // Same task_id, different error — should replace, not throw
    await db.recordFailedTask({
      task_id: 'test-task-8',
      batch_id: 'test-batch-6',
      task_type: 'chat_import',
      error: 'second error',
    });

    const task = await db.getFailedTask('test-task-8');
    expect(task!.error).toBe('second error');
    expect(task!.attempts).toBe(0); // reset on replace
  });
});

describe('Task 5: GET /api/import/chat/failed', () => {
  beforeEach(async () => {
    await db.run("DELETE FROM failed_tasks WHERE batch_id = 'api-test-batch'");
    await db.recordFailedTask({
      task_id: 'api-task-1',
      batch_id: 'api-test-batch',
      task_type: 'chat_import',
      conversation_title: 'Conv A',
      stage: 'extracting',
      error: 'LLM timeout',
      payload_snapshot: JSON.stringify({ title: 'Conv A', text: 'hello' }),
    });
    await db.recordFailedTask({
      task_id: 'api-task-2',
      batch_id: 'api-test-batch',
      task_type: 'conflict_resolution',
      conversation_title: 'Conv B',
      stage: 'resolving',
      error: 'conflict loop',
      payload_snapshot: JSON.stringify({ title: 'Conv B', text: 'world' }),
    });
  });

  it('returns 400 when batchId is missing', async () => {
    const { status, body } = await request('GET', '/api/import/chat/failed');
    expect(status).toBe(400);
    expect(body.error).toContain('batchId');
  });

  it('lists all failures for a batch', async () => {
    const { status, body } = await request('GET', '/api/import/chat/failed?batchId=api-test-batch');
    expect(status).toBe(200);
    expect(body.batchId).toBe('api-test-batch');
    expect(body.count).toBe(2);
    expect(body.tasks).toHaveLength(2);
    const titles = body.tasks.map((t: any) => t.conversation_title);
    expect(titles).toContain('Conv A');
    expect(titles).toContain('Conv B');
  });

  it('filters by status query parameter', async () => {
    // Mark one as resolved
    await db.updateFailedTaskStatus('api-task-1', 'resolved');

    const { status, body } = await request(
      'GET',
      '/api/import/chat/failed?batchId=api-test-batch&status=pending',
    );
    expect(status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.tasks[0].task_id).toBe('api-task-2');
  });

  it('returns empty list for unknown batch', async () => {
    const { status, body } = await request(
      'GET',
      '/api/import/chat/failed?batchId=nonexistent-batch',
    );
    expect(status).toBe(200);
    expect(body.count).toBe(0);
    expect(body.tasks).toEqual([]);
  });

  it('does not expose payload_snapshot in the response', async () => {
    const { status, body } = await request('GET', '/api/import/chat/failed?batchId=api-test-batch');
    expect(status).toBe(200);
    for (const task of body.tasks) {
      expect(task).not.toHaveProperty('payload_snapshot');
    }
  });
});

describe('Task 5: POST /api/import/chat/failed/:batchId/retry', () => {
  beforeEach(async () => {
    await db.run("DELETE FROM failed_tasks WHERE batch_id = 'retry-test-batch'");
    await db.recordFailedTask({
      task_id: 'retry-task-1',
      batch_id: 'retry-test-batch',
      task_type: 'chat_import',
      conversation_title: 'Retry Conv',
      stage: 'extracting',
      error: 'transient LLM error',
      payload_snapshot: JSON.stringify({
        title: 'Retry Conv',
        text: 'some conversation text here',
        time: '2026-01-01T00:00:00Z',
        platform: 'chatgpt',
      }),
    });
  });

  it('returns 200 with no_pending_failures when batch has no pending tasks', async () => {
    await db.updateFailedTaskStatus('retry-task-1', 'resolved');
    const { status, body } = await request(
      'POST',
      '/api/import/chat/failed/retry-test-batch/retry',
    );
    expect(status).toBe(200);
    expect(body.status).toBe('no_pending_failures');
    expect(body.retried).toBe(0);
  });

  it('returns 202 with jobId when there are pending failures', async () => {
    const { status, body } = await request(
      'POST',
      '/api/import/chat/failed/retry-test-batch/retry',
    );
    expect(status).toBe(202);
    expect(body.jobId).toBeDefined();
    expect(body.batchId).toBe('retry-test-batch');
    expect(body.retrying).toBeGreaterThanOrEqual(1);
    // The endpoint starts a fire-and-forget job. Wait for it so this test cannot
    // mutate the shared batch during the next test's beforeEach on slower CI hosts.
    expect(await waitForIngestJob(body.jobId)).toBe('success');
  }, 15000);

  it('retry job eventually resolves the failed task (mocked LLM)', async () => {
    const { body } = await request('POST', '/api/import/chat/failed/retry-test-batch/retry');
    const jobId = body.jobId;

    const jobStatus = await waitForIngestJob(jobId);
    expect(jobStatus).toBe('success');

    // The task should be marked resolved (mocked LLM succeeds)
    const task = await db.getFailedTask('retry-task-1');
    expect(task!.status).toBe('resolved');
    expect(task!.attempts).toBeGreaterThanOrEqual(1);
  }, 30000);
});

describe('Task 5: current schema verification', () => {
  it('failed_tasks table exists with correct columns', async () => {
    const cols = await db.all<{ name: string; type: string }>(
      "PRAGMA table_info(failed_tasks)",
    );
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('task_id');
    expect(colNames).toContain('batch_id');
    expect(colNames).toContain('task_type');
    expect(colNames).toContain('conversation_title');
    expect(colNames).toContain('session_id');
    expect(colNames).toContain('turn_id');
    expect(colNames).toContain('stage');
    expect(colNames).toContain('error');
    expect(colNames).toContain('payload_snapshot');
    expect(colNames).toContain('attempts');
    expect(colNames).toContain('status');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
  });

  it('ingestion_documents has session_id and idempotency_key columns', async () => {
    const cols = await db.all<{ name: string }>("PRAGMA table_info(ingestion_documents)");
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('session_id');
    expect(colNames).toContain('idempotency_key');
  });

  it('ingestion_chunks has session_id, turn_id, role, idempotency_key columns', async () => {
    const cols = await db.all<{ name: string }>("PRAGMA table_info(ingestion_chunks)");
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('session_id');
    expect(colNames).toContain('turn_id');
    expect(colNames).toContain('role');
    expect(colNames).toContain('idempotency_key');
  });

  it('schema version includes embedding index migrations', async () => {
    const row = await db.get<{ version: number }>(
      "SELECT MAX(id) AS version FROM migrations",
    );
    expect(row?.version).toBe(29);
  });
});
