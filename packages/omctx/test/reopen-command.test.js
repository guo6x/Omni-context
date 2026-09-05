import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdReopen } from '../src/commands/locked.js';
import { EXIT } from '../src/client/errors.js';

function healthResponse() {
  return new Response(JSON.stringify({
    ok: true,
    service: 'omni-context-brain-server',
    product_version: '0.1.0-alpha.0',
    control_protocol_version: '1.0',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('reopen uses only the fixed local control endpoint and sends no execution fields', async () => {
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const isolatedLocalAppData = mkdtempSync(join(tmpdir(), 'omctx-reopen-session-'));
  const sessionDir = join(isolatedLocalAppData, 'omni-context');
  let captured = '';
  const originalWrite = process.stdout.write;
  const requests = [];
  try {
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'reopen-session.json'), JSON.stringify({
      token: 'controlled-reopen-session-token',
      scope: 'control:reopen',
      expires_at: '2099-01-01T00:00:00.000Z',
    }), 'utf8');
    process.env.LOCALAPPDATA = isolatedLocalAppData;
    process.stdout.write = (chunk) => { captured += String(chunk); return true; };
    const code = await cmdReopen({
      json: true,
      args: ['decision-goal27-1'],
      reason: 'owner reconsideration after trusted mismatch',
      outcome: 'outcome-goal27-1',
      apiUrl: 'http://127.0.0.1:3001',
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        if (url.endsWith('/health')) return healthResponse();
        assert.equal(url, 'http://127.0.0.1:3001/api/control/reopen');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, 'Bearer controlled-reopen-session-token');
        assert.deepEqual(JSON.parse(options.body), {
          decision_id: 'decision-goal27-1',
          reason: 'owner reconsideration after trusted mismatch',
          outcome_id: 'outcome-goal27-1',
        });
        return new Response(JSON.stringify({ data: {
          revision_id: 'rev-goal27-0001', status: 'DECIDED', reopen_execution_count: 0, execution_started: false,
        } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    });
    assert.equal(code, EXIT.SUCCESS);
    assert.equal(requests.length, 2);
    assert.match(captured, /"command":"reopen"/);
    assert.match(captured, /"reopen_execution_count":0/);
    assert.doesNotMatch(captured, /controlled-reopen-session-token/);
  } finally {
    process.stdout.write = originalWrite;
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    rmSync(isolatedLocalAppData, { recursive: true, force: true });
  }
});
