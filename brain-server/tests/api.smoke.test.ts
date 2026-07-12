import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { createServer } from '../src/api/routes.js';
import { decodeEmbedding } from '../src/utils/math.js';
import { LLMExtractorPipeline } from '../src/graphrag/llm-pipeline.js';

// 端到端 smoke：启动真实 HTTP 服务，验证关键路由不再因路由顺序、
// CORS 头、参数 404 等问题而被静默打断。
let db: Database;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.LOCAL_API_TOKEN = 'test-token-123';

  // Mock LLM 提取，防止测试环境因没有 Ollama/LLM 导致网络连接 ECONNREFUSED 超时
  vi.spyOn(LLMExtractorPipeline.prototype, 'extract').mockResolvedValue({
    entities: [
      { name: 'UserService', type: 'concept', description: 'mock user service', tags: ['code'] }
    ],
    facts: [],
    principles: []
  });

  db = initDatabase({ dbPath: ':memory:' });
  await db.runMigrations();
  server = createServer(db);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  await db.close();
});

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  const url = `${baseUrl}${path}`;
  const authHeaders: Record<string, string> = {};
  if (process.env.LOCAL_API_TOKEN) {
    authHeaders['Authorization'] = `Bearer ${process.env.LOCAL_API_TOKEN}`;
  }
  const init: RequestInit = { method, headers: { ...authHeaders, ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
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
  const headerObj: http.IncomingHttpHeaders = {};
  res.headers.forEach((v, k) => {
    headerObj[k] = v;
  });
  return { status: res.status, body: parsed, headers: headerObj };
}

describe('API smoke: /health', () => {
  it('returns 200 with ok flag', async () => {
    const { status, body } = await request('GET', '/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.service).toBe('omni-context-brain-server');
  });

  it('sets baseline security headers', async () => {
    const { headers } = await request('GET', '/health');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('API smoke: notifications', () => {
  it('returns empty list for fresh DB', async () => {
    const { status, body } = await request('GET', '/api/notifications');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('API smoke: review tasks', () => {
  it('summarizes actionable curation tasks and demotes excess core principles', async () => {
    for (let i = 0; i < 35; i++) {
      await db.addEntity({
        name: `Review Core Principle ${i}`,
        type: 'principle',
        description: `Review task core principle ${i}`,
        metadata: { isCore: true },
        access_count: i % 4,
      });
    }
    await db.addEntity({
      name: 'Review Orphan Concept',
      type: 'concept',
      description: 'A concept without graph relationships',
      access_count: 0,
    });

    const summary = await request('GET', '/api/review/tasks?targetCoreCount=30');
    expect(summary.status).toBe(200);
    expect(summary.body.corePrinciples.total).toBeGreaterThanOrEqual(35);
    expect(summary.body.corePrinciples.overLimit).toBeGreaterThan(0);
    expect(summary.body.corePrinciples.demoteSamples.length).toBeGreaterThan(0);
    expect(summary.body.unlinkedByType.some((x: any) => x.type === 'concept')).toBe(true);

    const demote = await request('POST', '/api/review/core-principles/demote-excess', {
      targetCoreCount: 30,
    });
    expect(demote.status).toBe(200);
    expect(demote.body.demoted).toBeGreaterThan(0);

    const after = await request('GET', '/api/review/tasks?targetCoreCount=30');
    expect(after.status).toBe(200);
    expect(after.body.corePrinciples.total).toBeLessThanOrEqual(30);
  });
});

describe('API smoke: MCP usage log', () => {
  it('records successful MCP tool usage with matched entities', async () => {
    await db.addEntity({
      name: 'MCP Usage Trace Entity',
      type: 'concept',
      description: '用于验证 MCP 使用痕迹能被首页展示',
      tags: ['mcp-usage-test'],
    });

    const searchRes = await request('POST', '/api/mcp/tool/search_entities', {
      arguments: { query: 'MCP Usage Trace Entity', limit: 3 },
    }, { 'X-Omni-Client': 'vitest-client' });
    expect(searchRes.status).toBe(200);

    const usageRes = await request('GET', '/api/mcp/usage?limit=5');
    expect(usageRes.status).toBe(200);
    expect(Array.isArray(usageRes.body)).toBe(true);
    const latest = usageRes.body.find((x: any) => x.toolName === 'search_entities');
    expect(latest).toBeTruthy();
    expect(latest.client).toBe('vitest-client');
    expect(latest.query).toContain('MCP Usage Trace Entity');
    expect(latest.success).toBe(true);
    expect(latest.matchedEntities.some((e: any) => e.name === 'MCP Usage Trace Entity')).toBe(true);
  });
});

describe('API smoke: archival memory', () => {
  it('responds 200 with empty array on /api/memory/archival', async () => {
    const { status, body } = await request('GET', '/api/memory/archival');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns archival summary (static path beats :id)', async () => {
    // 这条专门用来回归"静态路径被 :id 吞掉"的曾经 bug
    const { status, body } = await request('GET', '/api/memory/archival/summary');
    expect(status).toBe(200);
    expect(body).toMatchObject({ totalItems: expect.any(Number) });
  });
});

describe('API smoke: core memory', () => {
  it('round-trips a memory item', async () => {
    const setRes = await request('POST', '/api/memory/core', {
      key: 'smoke-key',
      value: { hello: 'world' },
      category: 'smoke',
    });
    expect(setRes.status).toBe(201);

    const getRes = await request('GET', '/api/memory/core/smoke-key');
    expect(getRes.status).toBe(200);
    expect(getRes.body.value).toEqual({ hello: 'world' });
  });

  it('static /api/memory/core/stats is reachable (regression: was eaten by :key)', async () => {
    const { status, body } = await request('GET', '/api/memory/core/stats');
    expect(status).toBe(200);
    expect(body).toMatchObject({ totalItems: expect.any(Number) });
  });
});

describe('API smoke: graph extract', () => {
  it('extracts entities from inline text', async () => {
    // 接口接受 text/content/clipboard/screenshot 任一字段；这里走最常见的 text
    // 响应是计数 + summary（非完整数组），因此只断言形状
    const { status, body } = await request('POST', '/api/graph/extract', {
      text: 'class UserService { } function processData() { }',
    });
    expect(status).toBe(200);
    expect(typeof body.entities).toBe('number');
    expect(typeof body.relationships).toBe('number');
    expect(typeof body.principles).toBe('number');
  }, 15000);

  it('rejects non-JSON content-type', async () => {
    const url = `${baseUrl}/api/graph/extract`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Authorization': `Bearer ${process.env.LOCAL_API_TOKEN}`
      },
      body: 'plain text',
    });
    expect(res.status).toBe(415);
  });
});

describe('API smoke: domain validation', () => {
  it('rejects unknown entity and relationship types before database writes', async () => {
    const entity = await request('POST', '/api/entities', {
      name: 'Invalid entity',
      type: 'invented_type',
    });
    expect(entity.status).toBe(400);

    const relationship = await request('POST', '/api/relationships', {
      sourceId: 'source',
      targetId: 'target',
      type: 'invented_type',
    });
    expect(relationship.status).toBe(400);
  });
});

describe('API smoke: MCP retrieval precision', () => {
  it('caps unrelated core principles while preserving searched principles', async () => {
    const query = 'Project Alpha retrieval precision decision';
    for (let i = 0; i < 15; i++) {
      await db.addEntity({
        name: `Core Noise Principle ${i}`,
        type: 'principle',
        description: `Generic unrelated rule ${i}`,
        metadata: { isCore: true },
      });
    }
    await db.addEntity({
      name: 'Project Alpha Retrieval Principle',
      type: 'principle',
      description: `${query} should use project-specific memories before global principles`,
      metadata: { isCore: true },
    });

    const { status, body } = await request('POST', '/api/mcp/tool/get_decision_context', {
      arguments: { situation: query, limit: 6 },
    });

    expect(status).toBe(200);
    const principles = Array.isArray(body.principles) ? body.principles : [];
    const corePrinciples = principles.filter((p: any) =>
      typeof p.name === 'string' && p.name.startsWith('Core Noise Principle')
    );
    expect(corePrinciples).toHaveLength(0);
    expect(principles.some((p: any) => p.name === 'Project Alpha Retrieval Principle')).toBe(true);
  }, 15000);

  it('returns a capped general core context instead of injecting the entire core set', async () => {
    const { status, body } = await request('POST', '/api/mcp/tool/get_core_context', {
      arguments: {},
    });

    expect(status).toBe(200);
    expect(body.totalCorePrinciples).toBeGreaterThan(12);
    expect(body.returnedPrinciples).toBe(12);
    expect(body.truncated).toBe(true);
    expect(typeof body.content).toBe('string');
    expect(body.content).not.toContain('Metadata:');
  });

  it('filters core context by topic when query is provided', async () => {
    const { status, body } = await request('POST', '/api/mcp/tool/get_core_context', {
      arguments: { query: 'Project Alpha retrieval precision decision', limit: 5 },
    });

    expect(status).toBe(200);
    expect(body.content).toContain('Project Alpha Retrieval Principle');
    expect(body.content).not.toContain('Core Noise Principle');
  });

  it('does not force core principles into unified memory search results', async () => {
    const { status, body } = await request('POST', '/api/mcp/tool/unified_memory_search', {
      arguments: {
        query: 'Project Alpha retrieval precision decision',
        limit: 8,
        includeRelationships: false,
      },
    });

    expect(status).toBe(200);
    const results = Array.isArray(body.results) ? body.results : [];
    expect(results.some((r: any) => r.name === 'Project Alpha Retrieval Principle')).toBe(true);
    expect(results.some((r: any) =>
      typeof r.name === 'string' && r.name.startsWith('Core Noise Principle')
    )).toBe(false);
  }, 15000);
});

describe('API smoke: MCP resources', () => {
  async function readResource(uri: string): Promise<any> {
    const { status, body } = await request('POST', '/api/mcp/resources/read', { uri });
    expect(status).toBe(200);
    expect(body.contents).toHaveLength(1);
    return JSON.parse(body.contents[0].text);
  }

  it('returns compact capped graph data instead of raw database rows', async () => {
    const graph = await readResource('memory://graph');

    expect(graph.entities.length).toBeLessThanOrEqual(100);
    expect(graph.relationships.length).toBeLessThanOrEqual(150);
    expect(graph.truncated).toBe(true);
    for (const entity of graph.entities) {
      expect(entity).not.toHaveProperty('embedding');
      expect(entity).not.toHaveProperty('metadata');
    }
  });

  it('returns compact resource envelopes for principles and entity types', async () => {
    const principles = await readResource('memory://core-principles');
    expect(principles.returned).toBeLessThanOrEqual(20);
    expect(principles.items.length).toBe(principles.returned);
    for (const entity of principles.items) {
      expect(entity).not.toHaveProperty('embedding');
      expect(entity).not.toHaveProperty('metadata');
    }

    const concepts = await readResource('memory://entities/concept');
    expect(concepts.returned).toBeLessThanOrEqual(100);
    expect(concepts.items.length).toBe(concepts.returned);
    for (const entity of concepts.items) {
      expect(entity).not.toHaveProperty('embedding');
      expect(entity).not.toHaveProperty('metadata');
    }
  });
});

describe('API smoke: 404 / CORS', () => {
  it('unknown route returns 404 JSON', async () => {
    const { status, body } = await request('GET', '/api/nope/does-not-exist');
    expect(status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it('OPTIONS preflight succeeds with 204 and allow-methods', async () => {
    const { status, headers } = await request(
      'OPTIONS',
      '/api/memory/core',
      undefined,
      { Origin: 'http://localhost:3000' }
    );
    expect(status).toBe(204);
    expect(headers['access-control-allow-methods']).toContain('POST');
  });
});

describe('API smoke: ingest file', () => {
  it('accepts a small text file and returns extraction counts + archivalId', async () => {
    const text = 'class UserService { } function processData() { }';
    const base64 = Buffer.from(text, 'utf-8').toString('base64');
    const { status, body } = await request('POST', '/api/ingest/file', {
      filename: 'snippet.txt',
      contentType: 'text/plain',
      base64,
    });
    expect(status).toBe(200);
    expect(body.jobId).toBeDefined();

    // 轮询直至成功，超时设为 10 秒
    const jobId = body.jobId;
    let jobStatus = body.status;
    let jobResult: any;
    const start = Date.now();
    while (jobStatus !== 'success' && jobStatus !== 'failed' && (Date.now() - start < 10000)) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const getRes = await request('GET', `/api/ingest/job/${jobId}`);
      jobStatus = getRes.body.status;
      jobResult = getRes.body.result;
    }

    expect(jobStatus).toBe('success');
    expect(typeof jobResult.entities).toBe('number');
    expect(typeof jobResult.relationships).toBe('number');
    expect(typeof jobResult.archivalId).toBe('string');
    expect(jobResult.archivalId.length).toBeGreaterThan(0);
    expect(jobResult.documentId).toBe(jobId);
    expect(jobResult.chunking).toMatchObject({
      totalChunks: 1,
      processedChunks: 1,
      failedChunks: [],
      coverage: 1,
      truncated: false,
    });
    const storedDocument = await db.get<any>('SELECT * FROM ingestion_documents WHERE id = ?', [jobId]);
    const storedChunks = await db.all<any>('SELECT * FROM ingestion_chunks WHERE document_id = ?', [jobId]);
    expect(storedDocument).toMatchObject({ status: 'success', total_chunks: 1, coverage: 1 });
    expect(storedChunks).toHaveLength(1);
    expect(storedChunks[0]).toMatchObject({ status: 'success', attempts: 1, content: expect.stringContaining(text) });
  }, 30000);

  it('rejects unsupported contentType with 415', async () => {
    const base64 = Buffer.from('binary', 'utf-8').toString('base64');
    const { status } = await request('POST', '/api/ingest/file', {
      filename: 'thing.bin',
      contentType: 'application/octet-stream',
      base64,
    });
    expect(status).toBe(415);
  });

  it('retries only failed persisted chunks and updates attempts and coverage', async () => {
    const documentId = 'retry-document';
    const chunkId = 'retry-chunk';
    const content = 'class RetryEntity {}';
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO ingestion_documents (
         id, source, title, content_sha256, character_count, total_chunks,
         processed_chunks, failed_chunks, coverage, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [documentId, 'retry.txt', 'retry.txt', '0'.repeat(64), content.length, 1, 0, 1, 0, 'failed', now, now]
    );
    await db.run(
      `INSERT INTO ingestion_chunks (
         id, document_id, ordinal, source, content, source_span, start_offset,
         end_offset, source_timestamp, status, attempts, error, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [chunkId, documentId, 0, 'retry.txt', content, content, 0, content.length, now, 'failed', 1, 'initial failure', now, now]
    );

    const retry = await request('POST', `/api/ingest/document/${documentId}/retry`);
    expect(retry.status).toBe(202);
    let status = 'queued';
    let progress: any;
    const started = Date.now();
    while (!['success', 'failed'].includes(status) && Date.now() - started < 10_000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const job = await request('GET', `/api/ingest/job/${retry.body.jobId}`);
      status = job.body.status;
      progress = job.body.retryProgress;
    }
    expect(status).toBe('success');
    expect(progress).toMatchObject({ documentId, done: 1, total: 1, recovered: 1, failed: 0, coverage: 1 });
    expect(await db.get<any>('SELECT status, attempts, error FROM ingestion_chunks WHERE id = ?', [chunkId]))
      .toMatchObject({ status: 'success', attempts: 2, error: null });
    expect(await db.get<any>('SELECT status, processed_chunks, failed_chunks, coverage FROM ingestion_documents WHERE id = ?', [documentId]))
      .toMatchObject({ status: 'success', processed_chunks: 1, failed_chunks: 0, coverage: 1 });

    const complete = await request('POST', `/api/ingest/document/${documentId}/retry`);
    expect(complete).toMatchObject({ status: 200, body: { documentId, retried: 0, status: 'already_complete' } });
  });

  it('rejects missing filename with 400', async () => {
    const base64 = Buffer.from('hi', 'utf-8').toString('base64');
    const { status } = await request('POST', '/api/ingest/file', {
      contentType: 'text/plain',
      base64,
    });
    expect(status).toBe(400);
  });
});

describe('API smoke: admin export', () => {
  it('returns 200 with full backup payload including entities array', async () => {
    const { status, body, headers } = await request('GET', '/api/admin/export');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      version: 2,
      schemaVersion: 20,
      appVersion: '0.1.1',
      exportedAt: expect.any(String),
      entities: expect.any(Array),
      relationships: expect.any(Array),
      assertions: expect.any(Array),
      coreMemory: expect.any(Array),
      archivalMemory: expect.any(Array),
      notifications: expect.any(Array),
      discussions: expect.any(Array),
      behaviorEvents: expect.any(Array),
      proactiveInsights: expect.any(Array),
      embeddingMetadata: expect.any(Object),
      createdIndexesManifest: expect.any(Array),
    });
    expect(Array.isArray(body.entities)).toBe(true);
    expect(headers['content-disposition']).toContain('attachment');
  });

  it('merges semantic IDs, preserves versions, applies tombstones, and remaps relationships', async () => {
    const localSource = await db.addEntity({
      id: 'merge-local-source', name: 'Portable Concept', type: 'concept', description: 'same content',
    });
    const localTarget = await db.addEntity({
      id: 'merge-local-target', name: 'Portable Target', type: 'concept', description: 'target content',
    });
    const tombstoneTarget = await db.addEntity({
      id: 'merge-tombstone-target', name: 'Delete Me Safely', type: 'concept', description: 'retained historically',
    });
    const result = await request('POST', '/api/admin/import', {
      version: 2,
      exportedAt: new Date().toISOString(),
      mode: 'merge',
      entities: [
        { id: 'remote-source', name: localSource.name, type: localSource.type, description: localSource.description },
        { id: 'remote-target', name: localTarget.name, type: localTarget.type, description: localTarget.description },
        { id: 'remote-version', name: localSource.name, type: localSource.type, description: 'newer changed content', valid_from: '2027-01-01T00:00:00.000Z', metadata: '{}' },
        { id: tombstoneTarget.id, name: tombstoneTarget.name, type: tombstoneTarget.type, description: tombstoneTarget.description, metadata: JSON.stringify({ tombstone: true, deleted_at: '2026-08-01T00:00:00.000Z' }) },
      ],
      relationships: [
        { id: 'remote-remapped-relation', source_id: 'remote-source', target_id: 'remote-target', type: 'relates_to', weight: 1 },
      ],
      assertions: [
        { id: 'remote-remapped-assertion', subject_id: 'remote-source', predicate: 'references', object_id: 'remote-target', confidence: 1 },
      ],
      coreMemory: [], archivalMemory: [], notifications: [],
    });
    expect(result.status).toBe(200);
    expect(result.body.mergeReport).toMatchObject({
      sameIdConflicts: 1,
      semanticEntityRemaps: 2,
      preservedVersions: 1,
      tombstonesApplied: 1,
      relationshipRemaps: 1,
    });
    expect(await db.get<any>('SELECT source_id, target_id FROM relationships WHERE id = ?', ['remote-remapped-relation']))
      .toMatchObject({ source_id: localSource.id, target_id: localTarget.id });
    expect(await db.get<any>('SELECT subject_id, object_id FROM assertions WHERE id = ?', ['remote-remapped-assertion']))
      .toMatchObject({ subject_id: localSource.id, object_id: localTarget.id });
    expect(await db.get<any>('SELECT valid_until FROM entities WHERE id = ?', [tombstoneTarget.id]))
      .toMatchObject({ valid_until: '2026-08-01T00:00:00.000Z' });
    expect(await db.get<any>(
      "SELECT id FROM relationships WHERE type = 'historical_version_of' AND (source_id = 'remote-version' OR target_id = 'remote-version')",
    )).toBeDefined();
  });
});

describe('API smoke: admin seed demo', () => {
  it('imports seed demo data successfully when db is empty and skips on subsequent requests', async () => {
    // 0. 清空数据库，以防前述测试污染
    const cleanRes = await request('POST', '/api/admin/import', {
      version: 1,
      mode: 'replace',
      exportedAt: new Date().toISOString(),
      entities: [],
      relationships: [],
      coreMemory: [],
      archivalMemory: [],
      notifications: [],
    });
    expect(cleanRes.status).toBe(200);

    // 1. 发起 seed 导入
    const res1 = await request('POST', '/api/admin/seed-demo');
    expect(res1.status).toBe(200);
    expect(res1.body).toMatchObject({
      success: true,
      imported: {
        entities: expect.any(Number),
        relationships: expect.any(Number),
        coreMemory: expect.any(Number),
        archivalMemory: expect.any(Number),
        notifications: expect.any(Number),
      },
    });
    expect(res1.body.imported.entities).toBeGreaterThan(0);
    expect(res1.body.imported.relationships).toBe(36);

    // 2. 第二次发起 seed 导入，应该被幂等拦截跳过
    const res2 = await request('POST', '/api/admin/seed-demo');
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual({
      skipped: true,
      reason: '图谱已非空',
    });

    // 3. 验证数据确实已存在
    const { body: backup } = await request('GET', '/api/admin/export');
    expect(backup.entities.length).toBe(res1.body.imported.entities);
    expect(backup.relationships.length).toBe(36);
    expect(backup.coreMemory.length).toBe(res1.body.imported.coreMemory);
    expect(backup.archivalMemory.length).toBe(res1.body.imported.archivalMemory);
    expect(backup.notifications.length).toBe(res1.body.imported.notifications);
  });

  it('assigns embeddings to archival memory on seed-demo and allows semantic retrieval', async () => {
    const { body: backup } = await request('GET', '/api/admin/export');
    expect(backup.archivalMemory.length).toBeGreaterThan(0);
    for (const item of backup.archivalMemory) {
      expect(item.embedding).toBeDefined();
      expect(item.embedding).not.toBeNull();
    }

    const searchRes = await request('POST', '/api/memory/archival/search', {
      query: 'Letta 范式',
      limit: 2,
    });
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.length).toBeGreaterThan(0);
    expect(searchRes.body[0].item.content).toContain('Letta');
  });

  it('correctly builds search indexes (FTS5 and SQLite-Vec) after importing a backup', async () => {
    await db.setMeta('portable_setting', 'enabled');
    await db.upsertDiscussion({ title: 'Backup discussion', turns: [{ role: 'user', content: 'retain me' }] });
    await db.recordBehaviorEvent({ eventType: 'searched', topic: 'backup roundtrip' });
    const relationshipForDecay = await db.get<any>('SELECT id FROM relationships LIMIT 1');
    await db.run(
      `UPDATE relationships SET base_weight = 0.91, last_decay_at = '2026-07-01T00:00:00.000Z',
       last_reinforced_at = '2026-07-02T00:00:00.000Z', reinforcement_reason = 'roundtrip-test'
       WHERE id = ?`,
      [relationshipForDecay.id],
    );
    const { body: backup } = await request('GET', '/api/admin/export');
    expect(backup.entities.length).toBeGreaterThan(0);

    const importRes = await request('POST', '/api/admin/import', {
      ...backup,
      mode: 'replace',
    });
    expect(importRes.status).toBe(200);
    const { body: restoredBackup } = await request('GET', '/api/admin/export');
    for (const key of ['entities', 'relationships', 'assertions', 'coreMemory', 'archivalMemory', 'notifications', 'discussions', 'behaviorEvents']) {
      expect(restoredBackup[key].length, key).toBe(backup[key].length);
    }
    expect(restoredBackup.appMeta.some((row: any) => row.key === 'portable_setting' && row.value === 'enabled')).toBe(true);
    const restoredDecay = restoredBackup.relationships.find((row: any) => row.id === relationshipForDecay.id);
    expect(restoredDecay).toMatchObject({
      base_weight: 0.91,
      last_decay_at: '2026-07-01T00:00:00.000Z',
      last_reinforced_at: '2026-07-02T00:00:00.000Z',
      reinforcement_reason: 'roundtrip-test',
    });
    const restoredAssertions = await db.get<{ count: number }>('SELECT COUNT(*) AS count FROM assertions');
    expect(restoredAssertions?.count).toBe(
      backup.assertions.length > 0 ? backup.assertions.length : backup.relationships.length
    );

    const ftsRes = await request('POST', '/api/entities/search', {
      query: '代码安全性优先',
    });
    expect(ftsRes.status).toBe(200);
    expect(ftsRes.body.length).toBeGreaterThan(0);
    expect(ftsRes.body[0].name).toContain('代码安全性优先');

    const entitiesWithEmbedding = await db.all<any>('SELECT id, name, embedding FROM entities WHERE embedding IS NOT NULL');
    expect(entitiesWithEmbedding.length).toBeGreaterThan(0);
    const sampleEntity = entitiesWithEmbedding[0];
    const storedEmbedding = decodeEmbedding(sampleEntity.embedding);

    const vectorResults = await db.vectorSearch(storedEmbedding, 5);
    expect(vectorResults.length).toBeGreaterThan(0);
    const found = vectorResults.some(r => r.id === sampleEntity.id);
    expect(found).toBe(true);
  });
});
