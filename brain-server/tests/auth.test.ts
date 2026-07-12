import { createHash } from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import http from 'http';
import { tmpdir } from 'os';
import path from 'path';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer } from '../src/api/routes.js';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { requiredScope } from '../src/security/auth.js';

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
}

describe('route scope classification', () => {
  it('allows the browser read-only question tool without opening other MCP routes', () => {
    expect(requiredScope({ method: 'POST', url: '/api/mcp/tool/ask_memory' } as http.IncomingMessage))
      .toBe('memory:read');
    expect(requiredScope({ method: 'POST', url: '/api/mcp/tool/add_entity' } as http.IncomingMessage))
      .toBe('memory:write');
  });
});

describe('scoped device authentication', () => {
  let db: Database;
  let server: http.Server;
  let baseUrl: string;
  const localToken = 'local-desktop-test-token';
  const pairCode = '482731';

  beforeAll(async () => {
    process.env.LOCAL_API_TOKEN = localToken;
    process.env.PAIR_CODE = pairCode;
    delete process.env.PAIR_CODE_FILE;
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    server = createServer(db);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await closeServer(server);
    await db.close();
    delete process.env.LOCAL_API_TOKEN;
    delete process.env.PAIR_CODE;
  });

  async function request(
    method: string,
    route: string,
    token: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> | unknown[] }> {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown> | unknown[],
    };
  }

  it('exchanges a single-use pair code for a scoped, revocable token', async () => {
    const directAccess = await request('GET', '/api/entities', pairCode);
    expect(directAccess.status).toBe(401);

    const excessiveScopes = await request('POST', '/api/auth/pair/exchange', pairCode, {
      device_id: 'mobile-test-device-01',
      device_type: 'mobile',
      requested_scopes: ['admin:export'],
    });
    expect(excessiveScopes.status).toBe(403);

    const exchange = await request('POST', '/api/auth/pair/exchange', pairCode, {
      device_id: 'mobile-test-device-01',
      device_type: 'mobile',
    });
    expect(exchange.status).toBe(201);
    expect(exchange.body).toMatchObject({
      device_id: 'mobile-test-device-01',
      scopes: ['memory:read', 'decision:read'],
      issued_at: expect.any(String),
      expires_at: expect.any(String),
      device_token: expect.any(String),
    });

    const deviceToken = String((exchange.body as Record<string, unknown>).device_token);
    const tokenHash = createHash('sha256').update(deviceToken).digest('hex');
    const stored = await db.get<{ token_hash: string; last_used_at: string | null }>(
      'SELECT token_hash, last_used_at FROM device_tokens WHERE device_id = ?',
      ['mobile-test-device-01'],
    );
    expect(stored?.token_hash).toBe(tokenHash);
    expect(stored?.token_hash).not.toBe(deviceToken);
    expect(stored?.last_used_at).toBeNull();

    const replay = await request('POST', '/api/auth/pair/exchange', pairCode, {
      device_id: 'mobile-test-device-02',
      device_type: 'mobile',
    });
    expect(replay.status).toBe(401);

    const read = await request('GET', '/api/entities', deviceToken);
    expect(read.status).toBe(200);
    const used = await db.get<{ last_used_at: string | null }>(
      'SELECT last_used_at FROM device_tokens WHERE token_hash = ?',
      [tokenHash],
    );
    expect(used?.last_used_at).toEqual(expect.any(String));

    const write = await request('POST', '/api/graph/extract', deviceToken, { text: 'blocked write' });
    expect(write.status).toBe(403);
    const admin = await request('GET', '/api/admin/export', deviceToken);
    expect(admin.status).toBe(403);
    const settings = await request('GET', '/api/settings', deviceToken);
    expect(settings.status).toBe(403);
    const mcpTransport = await request('POST', '/mcp', deviceToken, {});
    expect(mcpTransport.status).toBe(403);

    const localAdmin = await request('GET', '/api/admin/export', localToken);
    expect(localAdmin.status).toBe(200);
    const deviceList = await request('GET', '/api/auth/devices', localToken);
    expect(deviceList.status).toBe(200);
    expect(JSON.stringify(deviceList.body)).not.toContain('token_hash');
    expect(JSON.stringify(deviceList.body)).not.toContain(deviceToken);
    const revoke = await request(
      'POST',
      '/api/auth/devices/mobile-test-device-01/revoke',
      localToken,
    );
    expect(revoke.status).toBe(200);

    const afterRevoke = await request('GET', '/api/entities', deviceToken);
    expect(afterRevoke.status).toBe(401);
  });
});

describe('device token migration', () => {
  it('upgrades a database that has all migrations through v12', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'omni-auth-migration-'));
    const dbPath = path.join(directory, 'legacy-v12.db');
    try {
      const prepared = initDatabase({ dbPath });
      await prepared.runMigrations();
      await prepared.run('DROP TABLE device_tokens');
      await prepared.run("DELETE FROM migrations WHERE name = 'add_scoped_device_tokens'");
      await prepared.close();

      const upgraded = initDatabase({ dbPath });
      await upgraded.runMigrations();
      const table = await upgraded.get<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'device_tokens'",
      );
      const migration = await upgraded.get<{ name: string }>(
        "SELECT name FROM migrations WHERE name = 'add_scoped_device_tokens'",
      );
      expect(table?.name).toBe('device_tokens');
      expect(migration?.name).toBe('add_scoped_device_tokens');
      await upgraded.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
