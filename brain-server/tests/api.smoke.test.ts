import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { createServer } from '../src/api/routes.js';

// 端到端 smoke：启动真实 HTTP 服务，验证关键路由不再因路由顺序、
// CORS 头、参数 404 等问题而被静默打断。
let db: Database;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
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
  const init: RequestInit = { method, headers: { ...headers } };
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
  });

  it('rejects non-JSON content-type', async () => {
    const url = `${baseUrl}/api/graph/extract`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'plain text',
    });
    expect(res.status).toBe(415);
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
    expect(typeof body.entities).toBe('number');
    expect(typeof body.relationships).toBe('number');
    expect(typeof body.archivalId).toBe('string');
    expect(body.archivalId.length).toBeGreaterThan(0);
  });

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
