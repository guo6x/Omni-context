import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import { createServer } from '../src/api/routes.js';
import initDatabase, { Database } from '../src/db/sqlite.js';

/**
 * Phase 5 (privacy & device security): per-tool scope enforcement on the
 * JSON-RPC `/mcp` entry. A device token issued with read-only scopes must be
 * able to call read tools but MUST be denied write/admin tools even though the
 * JSON-RPC transport itself only requires a valid bearer token.
 */

let db: Database;
let server: http.Server;
let baseUrl: string;
let deviceToken: string;

const localToken = 'device-scope-local-token';
const pairCode = '719354';

beforeAll(async () => {
  process.env.LOCAL_API_TOKEN = localToken;
  process.env.PAIR_CODE = pairCode;
  delete process.env.PAIR_CODE_FILE;
  db = initDatabase({ dbPath: ':memory:' });
  await db.runMigrations();
  server = createServer(db);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const exchange = await fetch(`${baseUrl}/api/auth/pair/exchange`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pairCode}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: 'esp32-scope-test', device_type: 'mobile' }),
  });
  expect(exchange.status).toBe(201);
  const body = await exchange.json() as { device_token: string; scopes: string[] };
  deviceToken = body.device_token;
  expect(body.scopes).toEqual(['memory:read', 'decision:read']);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())));
  await db.close();
  delete process.env.LOCAL_API_TOKEN;
  delete process.env.PAIR_CODE;
});

async function rpcCall(name: string, args: any): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

describe('JSON-RPC device permission scopes', () => {
  it('allows a read-scoped device to call a read tool', async () => {
    const { status, body } = await rpcCall('search_entities', { query: 'anything', limit: 3 });
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.result.content[0].type).toBe('text');
  });

  it('denies a write tool to a read-scoped device with a scope error', async () => {
    const { status, body } = await rpcCall('add_entity', {
      name: 'Scope Probe', type: 'concept', description: 'must be denied',
    });
    expect(status).toBe(200);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain('Permission denied: missing scope memory:write');
  });

  it('denies an admin tool to a read-scoped device', async () => {
    const { status, body } = await rpcCall('delete_entity', { id: 'whatever' });
    expect(status).toBe(200);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toContain('Permission denied: missing scope admin:delete');
  });

  it('revokes the device token immediately (401 on next request)', async () => {
    const revoke = await fetch(`${baseUrl}/api/auth/devices/esp32-scope-test/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localToken}` },
    });
    expect(revoke.status).toBe(200);
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deviceToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} }),
    });
    expect(res.status).toBe(401);
  });
});
