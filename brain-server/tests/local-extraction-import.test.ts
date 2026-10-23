import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { createServer } from '../src/api/routes.js';
import { MemoryDecayScheduler } from '../src/memory/decay-scheduler.js';
import { GraphRAGExtractor } from '../src/graphrag/extractor.js';
import { LLMExtractorPipeline } from '../src/graphrag/llm-pipeline.js';
import { resolveConflicts } from '../src/graphrag/conflict-resolver.js';
import { testEmbeddingService } from './helpers/test-embedding-service.js';

const TOKEN = 'LOCAL_ONLY_REMOTE_EMBEDDINGS';
const now = '2026-10-23T00:00:00.000Z';

let db: Database;
let server: http.Server;
let baseUrl: string;

function localEmbeddings() {
  return { ...testEmbeddingService, getConfiguredMode: () => 'local' as const };
}

async function startServer(embeddingService: unknown = localEmbeddings()): Promise<void> {
  db = initDatabase({ dbPath: ':memory:' });
  await db.runMigrations();
  await db.rebuildAllEmbeddings(testEmbeddingService as any);
  server = createServer(
    db,
    undefined,
    embeddingService as any,
    new MemoryDecayScheduler(db, { autoStart: false }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${process.env.LOCAL_API_TOKEN}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function waitForJob(jobId: string): Promise<any> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = await request('GET', `/api/ingest/job/${jobId}`);
    if (['success', 'partial', 'failed', 'cancelled'].includes(current.body?.status)) return current.body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`fixture import job did not finish: ${jobId}`);
}

function emptyExtraction() {
  return {
    entities: [],
    relationships: [],
    principles: [],
    diagnostics: {
      input_characters: 0,
      chunks: 1,
      llm_calls: [],
      parsed_counts: { entities: 0, facts: 0, principles: 0 },
      produced_counts: { entities: 0, relationships: 0, assertions: 0, principles: 0 },
      skipped_facts_missing_subject: 0,
    },
  } as any;
}

describe('request-scoped local-only import', () => {
  beforeEach(async () => {
    process.env.LOCAL_API_TOKEN = 'local-import-test-token';
    await startServer();
  }, 120_000);

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    await db?.close();
    vi.restoreAllMocks();
  }, 120_000);

  it('runs the real file route without invoking the enabled LLM pipeline and persists the mode', async () => {
    vi.spyOn(LLMExtractorPipeline.prototype, 'isEnabled').mockReturnValue(true);
    const remoteLlm = vi.spyOn(LLMExtractorPipeline.prototype, 'extractWithDiagnostics')
      .mockRejectedValue(new Error('local-only import attempted an LLM request'));
    const source = 'A personal note about a project decision and its next step.';
    const submitted = await request('POST', '/api/ingest/file', {
      filename: 'fixture.txt',
      contentType: 'text/plain',
      base64: Buffer.from(source).toString('base64'),
      useLocalExtraction: true,
    });

    expect(submitted.status).toBe(200);
    const job = await waitForJob(submitted.body.jobId);
    expect(job.status).toBe('success');
    expect(job.extractionMode).toBe('local_only');
    expect(remoteLlm).not.toHaveBeenCalled();
    expect(await db.get<any>('SELECT extraction_mode FROM ingestion_documents WHERE id = ?', [submitted.body.jobId]))
      .toEqual({ extraction_mode: 'local_only' });
    expect(await db.get<any>('SELECT extraction_mode FROM ingestion_chunks WHERE document_id = ?', [submitted.body.jobId]))
      .toEqual({ extraction_mode: 'local_only' });
    expect(await db.getImportJobReceipt(submitted.body.jobId)).toMatchObject({ extraction_mode: 'local_only' });
  }, 90_000);

  it('keeps local-only semantic conflicts pending for human review without calling the remote LLM', async () => {
    const source = await db.addEntity({ id: 'local-conflict-person', name: 'Synthetic Person', type: 'person' });
    const target = await db.addEntity({ id: 'local-conflict-project', name: 'Synthetic Project', type: 'project' });
    const old = await db.addRelationship({
      id: 'local-conflict-old', source_id: source.id, target_id: target.id,
      type: 'relates_to', description: 'Earlier synthetic context', weight: 0.8,
    });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('local-only conflict attempted a remote call'));

    const [inserted] = await resolveConflicts([{
      id: 'local-conflict-new', source_id: source.id, target_id: target.id,
      type: 'relates_to', description: 'New synthetic context', weight: 0.9,
    }], db, new GraphRAGExtractor({ llmBaseUrl: 'https://llm.example.invalid/v1' }), { localOnly: true });

    expect(fetch).not.toHaveBeenCalled();
    expect(inserted.id).toBe('local-conflict-new');
    expect(await db.getRelationshipsForEntity(source.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: old.id }),
      expect.objectContaining({ id: inserted.id }),
    ]));
    expect(await db.get<any>(
      'SELECT operation, confidence, reason, model_output, status FROM assertion_conflict_audit WHERE new_assertion_id = ?',
      ['relationship:local-conflict-new'],
    )).toMatchObject({
      operation: 'review',
      confidence: 0,
      reason: 'local-only import; semantic conflict needs human review',
      model_output: null,
      status: 'pending',
    });
  });

  it('retries failed chat and document chunks with the persisted local-only mode', async () => {
    const observedModes: Array<boolean | undefined> = [];
    let extractionCall = 0;
    vi.spyOn(GraphRAGExtractor.prototype, 'extract').mockImplementation(async (input) => {
      observedModes.push(input.useLocalExtraction);
      extractionCall++;
      if (extractionCall === 1) throw new Error('fixture transient extraction failure');
      return emptyExtraction();
    });

    const chat = await request('POST', '/api/import/chat', {
      text: JSON.stringify({ conversations: [{ chat_messages: [
        { sender: 'human', text: 'I chose this project because the work matters to me.' },
        { sender: 'assistant', text: 'That is a useful reason to preserve.' },
      ] }] }),
      useLocalExtraction: true,
    });
    expect(chat.status).toBe(200);
    expect((await waitForJob(chat.body.jobId)).status).toBe('failed');
    const failed = await db.getFailedTasks(chat.body.jobId, 'pending');
    expect(JSON.parse(failed[0].payload_snapshot || '{}').extractionMode).toBe('local_only');

    const chatRetry = await request('POST', `/api/import/chat/failed/${chat.body.jobId}/retry`);
    expect(chatRetry.status).toBe(202);
    expect((await waitForJob(chatRetry.body.jobId)).status).toBe('success');
    expect(observedModes).toEqual([true, true]);
    expect((await db.getImportJobReceipt(chatRetry.body.jobId))?.extraction_mode).toBe('local_only');

    const documentId = 'local-only-retry-document';
    const chunkId = 'local-only-retry-chunk';
    const content = 'Retry this synthetic local-only chunk.';
    await db.run(
      `INSERT INTO ingestion_documents (
         id, source, title, content_sha256, character_count, total_chunks,
         processed_chunks, failed_chunks, coverage, status, created_at, updated_at, extraction_mode
       ) VALUES (?, ?, ?, ?, ?, 1, 0, 1, 0, 'failed', ?, ?, 'local_only')`,
      [documentId, 'fixture.txt', 'fixture.txt', 'a'.repeat(64), content.length, now, now],
    );
    await db.run(
      `INSERT INTO ingestion_chunks (
         id, document_id, ordinal, source, content, source_span, start_offset,
         end_offset, source_timestamp, status, attempts, error, created_at, updated_at, extraction_mode
       ) VALUES (?, ?, 0, ?, ?, ?, 0, ?, ?, 'failed', 1, 'fixture failure', ?, ?, 'local_only')`,
      [chunkId, documentId, 'fixture.txt', content, content, content.length, now, now, now],
    );

    const chunkRetry = await request('POST', `/api/ingest/document/${documentId}/retry`);
    expect(chunkRetry.status).toBe(202);
    expect((await waitForJob(chunkRetry.body.jobId)).status).toBe('success');
    expect(observedModes.at(-1)).toBe(true);
  }, 90_000);

  it('blocks historical unknown-mode chat and document retries before AI or embeddings', async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.close();
    const remoteEmbedding = vi.fn(testEmbeddingService.embed);
    await startServer({ ...testEmbeddingService, getConfiguredMode: () => 'api' as const, embed: remoteEmbedding });
    vi.spyOn(LLMExtractorPipeline.prototype, 'isEnabled').mockReturnValue(true);
    const remoteLlm = vi.spyOn(LLMExtractorPipeline.prototype, 'extractWithDiagnostics')
      .mockRejectedValue(new Error('unknown-mode retry attempted remote LLM'));
    const extraction = vi.spyOn(GraphRAGExtractor.prototype, 'extract')
      .mockRejectedValue(new Error('unknown-mode retry invoked extraction'));

    await db.recordFailedTask({
      task_id: 'legacy-unknown-chat-task',
      batch_id: 'legacy-unknown-chat-batch',
      task_type: 'chat_import',
      conversation_title: 'Legacy synthetic conversation',
      stage: 'extracting',
      error: 'legacy failure',
      // Historical snapshots did not persist extractionMode.
      payload_snapshot: JSON.stringify({ title: 'Legacy synthetic conversation', text: 'Synthetic local fixture only.' }),
    });
    const chatRetry = await request('POST', '/api/import/chat/failed/legacy-unknown-chat-batch/retry');

    const insertDocument = async (documentId: string, extractionMode: string | null) => {
      await db.run(
        `INSERT INTO ingestion_documents (
           id, source, title, content_sha256, character_count, total_chunks,
           processed_chunks, failed_chunks, coverage, status, created_at, updated_at, extraction_mode
         ) VALUES (?, ?, ?, ?, ?, 1, 0, 1, 0, 'failed', ?, ?, ?)`,
        [documentId, `${documentId}.txt`, `${documentId}.txt`, 'c'.repeat(64), 21, now, now, extractionMode],
      );
      await db.run(
        `INSERT INTO ingestion_chunks (
           id, document_id, ordinal, source, content, source_span, start_offset,
           end_offset, source_timestamp, status, attempts, error, created_at, updated_at, extraction_mode
         ) VALUES (?, ?, 0, ?, ?, ?, 0, 21, ?, 'failed', 1, 'legacy failure', ?, ?, NULL)`,
        [`${documentId}-chunk`, documentId, `${documentId}.txt`, 'synthetic local fixture only', 'synthetic local fixture only', now, now, now],
      );
    };
    // Cover both old document-level NULL receipts and a chunk whose mode is
    // unknown even though its parent document has a known configured mode.
    await insertDocument('legacy-unknown-document-mode', null);
    await insertDocument('legacy-unknown-chunk-mode', 'default');
    const unknownDocumentRetry = await request('POST', '/api/ingest/document/legacy-unknown-document-mode/retry');
    const unknownChunkRetry = await request('POST', '/api/ingest/document/legacy-unknown-chunk-mode/retry');

    for (const response of [chatRetry, unknownDocumentRetry, unknownChunkRetry]) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        error_code: 'UNKNOWN_EXTRACTION_MODE_NEEDS_REIMPORT',
        action: 'reimport_with_explicit_mode',
      });
      expect(response.body.message).toMatch(/No AI or embedding request was sent/);
    }
    expect((await db.getFailedTask('legacy-unknown-chat-task'))).toMatchObject({ status: 'pending', attempts: 0 });
    expect(await db.all<any>(
      `SELECT status, attempts FROM ingestion_chunks
       WHERE document_id IN ('legacy-unknown-document-mode', 'legacy-unknown-chunk-mode') ORDER BY document_id`,
    )).toEqual([
      { status: 'failed', attempts: 1 },
      { status: 'failed', attempts: 1 },
    ]);
    expect(extraction).not.toHaveBeenCalled();
    expect(remoteLlm).not.toHaveBeenCalled();
    expect(remoteEmbedding).not.toHaveBeenCalled();
    expect((await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM import_job_receipts'))?.count).toBe(0);
  }, 90_000);

  it('rejects local-only requests with remote embeddings before creating any job', async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.close();
    await startServer({ ...testEmbeddingService, getConfiguredMode: () => 'api' });

    const file = await request('POST', '/api/ingest/file', {
      filename: 'fixture.txt', contentType: 'text/plain',
      base64: Buffer.from('synthetic private fixture').toString('base64'),
      useLocalExtraction: true,
    });
    const chat = await request('POST', '/api/import/chat', {
      text: JSON.stringify([{ role: 'user', text: 'synthetic private fixture conversation' }]),
      useLocalExtraction: true,
    });
    expect(file).toMatchObject({ status: 409, body: { error: TOKEN, error_code: TOKEN } });
    expect(chat).toMatchObject({ status: 409, body: { error: TOKEN, error_code: TOKEN } });
    expect((await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM import_job_receipts'))?.count).toBe(0);
    expect((await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM ingestion_documents'))?.count).toBe(0);

    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.close();
    // A missing mode capability is not proof that a local-only request cannot
    // use a remote embedding provider, so the same request must fail closed.
    await startServer({ ...testEmbeddingService });
    const unknownEmbeddingMode = await request('POST', '/api/ingest/file', {
      filename: 'fixture.txt', contentType: 'text/plain',
      base64: Buffer.from('synthetic private fixture').toString('base64'),
      useLocalExtraction: true,
    });
    expect(unknownEmbeddingMode).toMatchObject({ status: 409, body: { error: TOKEN, error_code: TOKEN } });
    expect((await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM import_job_receipts'))?.count).toBe(0);
  }, 90_000);
});

describe('v31 import compatibility', () => {
  it('adds nullable mode fields without rewriting legacy receipts or ingestion rows', async () => {
    const legacy = initDatabase({ dbPath: ':memory:' });
    try {
      await legacy.runMigrations();
      await legacy.run('ALTER TABLE ingestion_documents DROP COLUMN extraction_mode');
      await legacy.run('ALTER TABLE ingestion_chunks DROP COLUMN extraction_mode');
      await legacy.run('ALTER TABLE import_job_receipts DROP COLUMN extraction_mode');
      await legacy.run("DELETE FROM migrations WHERE name = 'persist_import_extraction_mode'");
      await legacy.run(
        `INSERT INTO import_job_receipts (job_id, status, stage, created_at, updated_at)
         VALUES ('legacy-job', 'success', 'done', 10, 20)`,
      );
      await legacy.run(
        `INSERT INTO ingestion_documents (
           id, source, title, content_sha256, character_count, total_chunks,
           processed_chunks, failed_chunks, coverage, status, created_at, updated_at
         ) VALUES ('legacy-doc', 'old.txt', 'old.txt', ?, 4, 1, 1, 0, 1, 'success', ?, ?)`,
        ['b'.repeat(64), now, now],
      );
      await legacy.run(
        `INSERT INTO ingestion_chunks (
           id, document_id, ordinal, source, content, source_span, start_offset,
           end_offset, source_timestamp, status, attempts, created_at, updated_at
         ) VALUES ('legacy-chunk', 'legacy-doc', 0, 'old.txt', 'data', 'data', 0, 4, ?, 'success', 1, ?, ?)`,
        [now, now, now],
      );

      await legacy.runMigrations();

      expect(await legacy.getImportJobReceipt('legacy-job')).toMatchObject({
        status: 'success', stage: 'done', created_at: 10, updated_at: 20, extraction_mode: 'unknown',
      });
      expect(await legacy.get<any>('SELECT extraction_mode FROM ingestion_documents WHERE id = ?', ['legacy-doc']))
        .toEqual({ extraction_mode: null });
      expect(await legacy.get<any>('SELECT extraction_mode FROM ingestion_chunks WHERE id = ?', ['legacy-chunk']))
        .toEqual({ extraction_mode: null });
      expect(await legacy.get<any>('SELECT content_sha256, status FROM ingestion_documents WHERE id = ?', ['legacy-doc']))
        .toEqual({ content_sha256: 'b'.repeat(64), status: 'success' });
      expect(await legacy.get<any>("SELECT name FROM migrations WHERE name = 'persist_import_extraction_mode'"))
        .toEqual({ name: 'persist_import_extraction_mode' });
    } finally {
      await legacy.close();
    }
  }, 120_000);
});
