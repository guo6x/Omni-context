import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import initDatabase, { Database } from '../src/db/sqlite.js';
import { createServer } from '../src/api/routes.js';
import { createProductionAuthorizationRuntime } from '../src/approval/production-runtime.js';
import { AgentPilotAdapter } from '../src/agent/pilot.js';

describe('Goal26 AGENT_PILOT least-authority profile', () => {
  let db: Database;
  let server: http.Server;
  let baseUrl: string;
  let token: string;

  beforeAll(async () => {
    process.env.LOCAL_API_TOKEN = 'goal26-local';
    process.env.PAIR_CODE = '264826';
    db = initDatabase({ dbPath: ':memory:' });
    await db.runMigrations();
    const runtime = createProductionAuthorizationRuntime();
    server = createServer(db, null, undefined, undefined, undefined, runtime.controlRuntime, runtime.verificationRuntime,
      new AgentPilotAdapter({ evidenceRuntime: runtime.evidenceRuntime, authorizationService: runtime.authorizationService, verificationRuntime: runtime.verificationRuntime }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const exchange = await fetch(`${baseUrl}/api/auth/pair/exchange`, {
      method: 'POST', headers: { Authorization: 'Bearer 264826', 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'agent-pilot-test', device_type: 'agent_pilot' }),
    });
    expect(exchange.status).toBe(201);
    token = (await exchange.json() as { device_token: string }).device_token;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await db.close();
    delete process.env.LOCAL_API_TOKEN;
    delete process.env.PAIR_CODE;
  });

  async function rpc(name: string, args: unknown = {}) {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return response.json();
  }

  it('lists only the four agent tools', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'agent_ask', 'agent_inspect', 'agent_history', 'agent_outcome',
    ]);
  });

  it('blocks legacy memory writes and control-shaped tool names', async () => {
    const write = await rpc('add_entity', { name: 'probe', type: 'concept' });
    expect(write.error?.message).toContain('AGENT_PILOT allowlist');
    const spoof = await rpc('approve');
    expect(spoof.error?.message).toContain('Unknown tool');
  });

  it('allows a real decision question but never returns authority material', async () => {
    const response = await fetch(`${baseUrl}/api/agent/ask`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Is it eligible to close this issue?', capability_id: 'github.issue.close', capability_version: '1.0.0', normalized_inputs: { owner: 'fixture-owner', repo: 'fixture-repo', number: 1 } }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('decision_id');
    expect(['DECIDE', 'CLARIFY', 'DEFER', 'BLOCK']).toContain(body.disposition);
    expect(JSON.stringify(body)).not.toContain('token_reference');
    expect(JSON.stringify(body)).not.toContain('NATIVE_BRIDGE_SECRET');
  });
});
