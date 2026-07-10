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
      version: 1,
      exportedAt: expect.any(String),
      entities: expect.any(Array),
      relationships: expect.any(Array),
      coreMemory: expect.any(Array),
      archivalMemory: expect.any(Array),
      notifications: expect.any(Array),
    });
    expect(Array.isArray(body.entities)).toBe(true);
    expect(headers['content-disposition']).toContain('attachment');
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
    const { body: backup } = await request('GET', '/api/admin/export');
    expect(backup.entities.length).toBeGreaterThan(0);

    const importRes = await request('POST', '/api/admin/import', {
      ...backup,
      mode: 'replace',
    });
    expect(importRes.status).toBe(200);

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
