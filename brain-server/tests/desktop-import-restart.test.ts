import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fixtureConversations,
  startDesktopImportFixture,
  type DesktopImportFixture,
} from './fixtures/desktop-import-server.js';

describe('CONTROLLED_FIXTURE: import receipt recovery across Brain restarts', () => {
  let fixture: DesktopImportFixture | undefined;
  let dbDirectory: string | undefined;
  let dbPath: string;
  let token: string;

  async function startFixture(): Promise<void> {
    fixture = await startDesktopImportFixture({ port: 0, llmPort: 0, dbPath });
  }

  beforeEach(async () => {
    token = randomBytes(32).toString('hex');
    vi.stubEnv('OMNI_DESKTOP_IMPORT_FIXTURE', '1');
    vi.stubEnv('LOCAL_API_TOKEN', token);
    vi.stubEnv('CORS_ORIGINS', 'http://127.0.0.1:3018');
    dbDirectory = await mkdtemp(path.join(tmpdir(), 'omni-import-restart-fixture-'));
    dbPath = path.join(dbDirectory, 'controlled.sqlite');
    await startFixture();
  }, 120_000);

  afterEach(async () => {
    try {
      await fixture?.close();
    } finally {
      fixture = undefined;
      if (dbDirectory) await rm(dbDirectory, { recursive: true, force: true });
      dbDirectory = undefined;
      vi.unstubAllEnvs();
    }
  });

  async function request(method: string, route: string, body?: unknown) {
    const response = await fetch(`${fixture!.baseUrl}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  }

  async function waitForTerminal(jobId: string): Promise<any> {
    let terminal: any;
    await vi.waitFor(async () => {
      const response = await request('GET', `/api/ingest/job/${jobId}`);
      expect(response.status).toBe(200);
      expect(['queued', 'running']).not.toContain(response.body.status);
      terminal = response.body;
    }, { timeout: 30_000, interval: 50 });
    return terminal;
  }

  it('restores terminal progress and counts without retaining import content', async () => {
    const submitted = await request('POST', '/api/import/chat', {
      text: JSON.stringify(fixtureConversations),
    });
    expect(submitted.status).toBe(200);
    const jobId = submitted.body.jobId as string;
    const original = await waitForTerminal(jobId);
    expect(original.status).toBe('partial');
    expect(original.result.failure_count).toBe(1);

    const stored = await fixture!.db.all<Record<string, unknown>>(
      'SELECT * FROM import_job_receipts WHERE job_id = ?', [jobId],
    );
    const storedJson = JSON.stringify(stored);
    expect(storedJson).not.toContain('产品方向');
    expect(storedJson).not.toContain('受控失败记录');
    expect(storedJson).not.toContain('[fixture-fail]');
    const receiptColumns = await fixture!.db.all<{ name: string }>('PRAGMA table_info(import_job_receipts)');
    expect(receiptColumns.map((column) => column.name)).not.toEqual(expect.arrayContaining([
      'filename', 'source_text', 'conversation_title', 'provider_response', 'credential', 'file_path',
    ]));

    await fixture!.close();
    fixture = undefined;
    vi.resetModules();
    await startFixture();

    const restored = await request('GET', `/api/ingest/job/${jobId}`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({
      jobId,
      status: 'partial',
      importProgress: { done: 2, total: 2, entities: 1 },
      result: { entities: 1, relationships: 0, principles: 0, failure_count: 1 },
    });
    expect(restored.body.result).not.toHaveProperty('failed_conversations');
    expect(restored.body).not.toHaveProperty('sourceText');
    expect(fixture!.llmCalls.extractions).toBe(0);
  }, 45_000);

  it('surfaces an interrupted job as partial and never replays its source automatically', async () => {
    const jobId = 'controlled-interrupted-job';
    await fixture!.db.saveImportJobReceipt({
      job_id: jobId,
      status: 'running',
      stage: 'extracting',
      created_at: Date.now() - 5_000,
      import_progress: { done: 1, total: 3, entities: 2 },
      updated_at: Date.now(),
    });

    await fixture!.close();
    fixture = undefined;
    vi.resetModules();
    await startFixture();

    const restored = await request('GET', `/api/ingest/job/${jobId}`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({
      jobId,
      status: 'partial',
      stage: 'interrupted',
      importProgress: { done: 1, total: 3, entities: 2 },
      result: { summary: 'This import was interrupted. Review your library before importing again.' },
      error: 'This import was interrupted by an app restart. Review your library before importing again.',
    });
    expect(fixture!.llmCalls.extractions).toBe(0);
    expect(await fixture!.db.all('SELECT job_id FROM import_job_receipts WHERE job_id = ?', [jobId]))
      .toHaveLength(1);
  });

  it('keeps a completed import recoverable when its terminal receipt cannot be saved', async () => {
    const saveReceipt = fixture!.db.saveImportJobReceipt.bind(fixture!.db);
    fixture!.db.saveImportJobReceipt = async (receipt) => {
      if (receipt.status === 'success') throw new Error('CONTROLLED_FIXTURE_RECEIPT_WRITE_FAILURE');
      await saveReceipt(receipt);
    };

    const submitted = await request('POST', '/api/import/chat', {
      text: JSON.stringify([fixtureConversations[0]]),
    });
    expect(submitted.status).toBe(200);
    const jobId = submitted.body.jobId as string;
    const terminal = await waitForTerminal(jobId);
    expect(terminal).toMatchObject({
      status: 'partial',
      stage: 'receipt_unavailable',
      error: 'The import finished, but its status could not be safely saved. Review your library before importing again.',
    });
    expect(await fixture!.db.get<{ status: string }>(
      'SELECT status FROM import_job_receipts WHERE job_id = ?', [jobId],
    )).toMatchObject({ status: 'running' });

    await fixture!.close();
    fixture = undefined;
    vi.resetModules();
    await startFixture();
    const restored = await request('GET', `/api/ingest/job/${jobId}`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({
      status: 'partial',
      stage: 'interrupted',
      error: 'This import was interrupted by an app restart. Review your library before importing again.',
    });
    expect(fixture!.llmCalls.extractions).toBe(0);
  }, 45_000);

  it('applies migration 31 to an existing v30 database without changing prior records', async () => {
    const entity = await fixture!.db.addEntity({
      name: 'Existing v30 entity',
      type: 'concept',
      description: 'Data created before the import-receipt migration.',
    });
    await fixture!.db.run('DROP TABLE import_job_receipts');
    await fixture!.db.run('DELETE FROM migrations WHERE name = ?', ['persist_privacy_minimal_import_job_receipts']);

    await fixture!.close();
    fixture = undefined;
    vi.resetModules();
    await startFixture();

    expect(await fixture!.db.get('SELECT id FROM entities WHERE id = ?', [entity.id]))
      .toMatchObject({ id: entity.id });
    expect(await fixture!.db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM migrations WHERE name = ?',
      ['persist_privacy_minimal_import_job_receipts'],
    )).toMatchObject({ count: 1 });
    expect(await fixture!.db.get('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', 'import_job_receipts']))
      .toMatchObject({ name: 'import_job_receipts' });
  });

  it('restores the failed chunk count for a retry after Brain restarts', async () => {
    const documentId = 'controlled-retry-document';
    const chunkId = 'controlled-retry-chunk';
    const content = '[fixture-fail] a synthetic failed chunk for receipt recovery';
    const now = new Date().toISOString();
    await fixture!.db.run(
      `INSERT INTO ingestion_documents (
         id, source, title, content_sha256, character_count, total_chunks,
         processed_chunks, failed_chunks, coverage, status, created_at, updated_at,
         extraction_mode
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [documentId, 'synthetic-retry.txt', 'synthetic-retry.txt', '0'.repeat(64), content.length, 1, 0, 1, 0, 'failed', now, now, 'default'],
    );
    await fixture!.db.run(
      `INSERT INTO ingestion_chunks (
         id, document_id, ordinal, source, content, source_span, start_offset,
         end_offset, source_timestamp, status, attempts, error, created_at, updated_at,
         extraction_mode
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [chunkId, documentId, 0, 'synthetic-retry.txt', content, content, 0, content.length, now, 'failed', 1, 'CONTROLLED_FIXTURE_FAILURE', now, now, 'default'],
    );

    const submitted = await request('POST', `/api/ingest/document/${documentId}/retry`);
    expect(submitted.status).toBe(202);
    const terminal = await waitForTerminal(submitted.body.jobId);
    expect(terminal.status).toBe('failed');
    expect(terminal.result.failure_count).toBe(1);

    await fixture!.close();
    fixture = undefined;
    vi.resetModules();
    await startFixture();

    const restored = await request('GET', `/api/ingest/job/${submitted.body.jobId}`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({
      status: 'failed',
      retryProgress: { done: 1, total: 1, recovered: 0, failed: 1 },
      result: { failure_count: 1, chunking: { failedCount: 1 } },
    });
  }, 45_000);

  it('does not double-count failed chunks in an in-progress retry receipt', async () => {
    const documentId = 'controlled-retry-checkpoint';
    const chunks = [
      '[fixture-fail] a synthetic failed chunk before the checkpoint',
      '[fixture-hold] a synthetic held chunk after the checkpoint',
    ];
    const now = new Date().toISOString();
    await fixture!.db.run(
      `INSERT INTO ingestion_documents (
         id, source, title, content_sha256, character_count, total_chunks,
         processed_chunks, failed_chunks, coverage, status, created_at, updated_at,
         extraction_mode
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [documentId, 'synthetic-retry-checkpoint.txt', 'synthetic-retry-checkpoint.txt', '1'.repeat(64),
        chunks.join('').length, chunks.length, 0, chunks.length, 0, 'failed', now, now, 'default'],
    );
    for (const [ordinal, content] of chunks.entries()) {
      await fixture!.db.run(
        `INSERT INTO ingestion_chunks (
           id, document_id, ordinal, source, content, source_span, start_offset,
           end_offset, source_timestamp, status, attempts, error, created_at, updated_at,
           extraction_mode
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`${documentId}-${ordinal}`, documentId, ordinal, 'synthetic-retry-checkpoint.txt', content,
          content, 0, content.length, now, 'failed', 1, 'CONTROLLED_FIXTURE_FAILURE', now, now, 'default'],
      );
    }

    const submitted = await request('POST', `/api/ingest/document/${documentId}/retry`);
    expect(submitted.status).toBe(202);
    await vi.waitFor(() => expect(fixture!.llmCalls.heldExtractions).toBe(1), { timeout: 20_000, interval: 20 });

    const checkpoint = await fixture!.db.get<{
      retry_done: number; retry_failed: number; result_failure_count: number;
    }>(
      `SELECT retry_done, retry_failed, result_failure_count
       FROM import_job_receipts WHERE job_id = ?`,
      [submitted.body.jobId],
    );
    expect(checkpoint).toMatchObject({
      retry_done: 1,
      retry_failed: 1,
      result_failure_count: 1,
    });
    fixture!.releaseHeldExtractions();
    const terminal = await waitForTerminal(submitted.body.jobId);
    expect(terminal.result.failure_count).toBe(1);
  }, 45_000);
});
