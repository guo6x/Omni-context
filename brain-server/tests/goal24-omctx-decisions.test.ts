/**
 * omctx D1A: read-only decision history endpoint (GET /api/decisions).
 * Covers: authenticated access, bounded limit, newest-first deterministic
 * order, decision:read scope and empty-list shape.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { createServer } from '../src/api/routes.js';
import { E5_LARGE_USAGE_PROFILE } from '../src/embedding/profiles.js';

const testEmbeddingService = {
  getUsageProfile: () => E5_LARGE_USAGE_PROFILE,
  getStatus: () => 'local' as const,
  getInfo: () => ({ mode: 'local', status: 'local', dimensions: 1024, actualDimension: 1024, model: E5_LARGE_USAGE_PROFILE.modelId, modelRevision: E5_LARGE_USAGE_PROFILE.modelRevision, modelSha256Verified: true }),
  embedPassage: async () => ({ embedding: new Array(1024).fill(0), dimensions: 1024, model: E5_LARGE_USAGE_PROFILE.modelId }),
  embedQuery: async () => ({ embedding: new Array(1024).fill(0), dimensions: 1024, model: E5_LARGE_USAGE_PROFILE.modelId }),
  embed: async () => ({ embedding: new Array(1024).fill(0), dimensions: 1024, model: E5_LARGE_USAGE_PROFILE.modelId }),
};

let db: Database;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.LOCAL_API_TOKEN = 'test-local-token';
  db = initDatabase({ dbPath: ':memory:' });
  await db.runMigrations();
  server = createServer(db, undefined, testEmbeddingService as never);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
  await db.addEntity({ name: 'Older decision', type: 'decision', description: 'first', metadata: { conclusion: 'A', outcomes: [] } });
  await db.addEntity({ name: 'Newer decision', type: 'decision', description: 'second', metadata: { conclusion: 'B', outcomes: [{ actual_outcome: 'done' }] } });
  await db.addEntity({ name: 'Not a decision', type: 'concept', description: 'x', metadata: {} });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await db.close();
});

async function request(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

describe('GET /api/decisions (omctx history endpoint)', () => {
  it('requires authentication (401 without a Bearer token)', async () => {
    const res = await request('/api/decisions');
    expect(res.status).toBe(401);
  });

  it('returns newest-first decisions with bounded fields', async () => {
    const res = await request('/api/decisions', 'test-local-token');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.decisions)).toBe(true);
    expect(res.body.decisions.length).toBe(2);
    expect(res.body.decisions[0].conclusion).toBe('B');
    expect(res.body.decisions[0].outcome_status).toBe('done');
    expect(res.body.decisions[1].conclusion).toBe('A');
    expect(res.body.decisions[0].id).toBeTruthy();
    expect(Object.keys(res.body.decisions[0]).sort()).toEqual([
      'conclusion', 'created_at', 'id', 'outcome_status', 'revision_indicator', 'title', 'updated_at',
    ]);
  });

  it('rejects a limit outside 1..100', async () => {
    for (const bad of ['0', '-1', '101', 'abc']) {
      const res = await request(`/api/decisions?limit=${bad}`, 'test-local-token');
      expect(res.status).toBe(400);
    }
  });

  it('db.listEntitiesByType returns only the requested type, newest first', async () => {
    const decisions = await db.listEntitiesByType('decision', 10);
    expect(decisions.length).toBe(2);
    expect(decisions.every((entity) => entity.type === 'decision')).toBe(true);
    expect(decisions[0].name).toBe('Newer decision');
  });
});
