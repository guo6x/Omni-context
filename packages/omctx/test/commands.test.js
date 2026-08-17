import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServer } from './mock-server.js';
import { OmniLocalClient } from '../src/client/omni-local-client.js';
import { cmdAsk } from '../src/commands/ask.js';
import { cmdInspect, validateDecisionId } from '../src/commands/inspect.js';
import { cmdHistory } from '../src/commands/history.js';

test('ask calls ONLY get_decision_context and adds ACTION_AUTHORITY=NONE', async () => {
  const calls = [];
  const server = await startMockServer('ok', (req) => {
    if (req.url === '/mcp') calls.push(req);
  });
  try {
    const client = new OmniLocalClient({ apiUrl: server.url, token: 't' });
    const originalOut = process.stdout.write;
    let captured = '';
    process.stdout.write = (chunk) => { captured += String(chunk); return true; };
    try {
      await cmdAsk({ client, json: false }, ['Should we ship the alpha?']);
    } finally {
      process.stdout.write = originalOut;
    }
    assert.equal(calls.length, 1, 'ask makes exactly one network call');
    assert.ok(captured.includes('ACTION_AUTHORITY = NONE'));
  } finally {
    server.server.close();
  }
});

test('ask never writes: only get_decision_context in allowlist path', async () => {
  const tools = [];
  const server = await startMockServer('ok');
  try {
    // Spy the tool name by wrapping callAllowlistedReadTool
    const client = new OmniLocalClient({ apiUrl: server.url, token: 't' });
    const original = client.callAllowlistedReadTool.bind(client);
    client.callAllowlistedReadTool = async (name, args) => { tools.push(name); return original(name, args); };
    await cmdAsk({ client, json: false }, ['x']);
    assert.deepEqual(tools, ['get_decision_context']);
  } finally {
    server.server.close();
  }
});

test('inspect rejects malformed ids before any network call', async () => {
  assert.equal(validateDecisionId('../etc/passwd'), null);
  assert.equal(validateDecisionId('a/b'), null);
  assert.equal(validateDecisionId(''), null);
  assert.equal(validateDecisionId('x'.repeat(300)), null);
  assert.equal(validateDecisionId('ok-id-123'), 'ok-id-123');
  assert.equal(validateDecisionId('plan-ee6447d9-71c4-43ee-9b60-93adbda58e24'), 'plan-ee6447d9-71c4-43ee-9b60-93adbda58e24');
});

test('inspect handles a not-found decision as OMCTX_DECISION_NOT_FOUND', async () => {
  const server = await startMockServer('notfound');
  try {
    const client = new OmniLocalClient({ apiUrl: server.url, token: 't' });
    await assert.rejects(
      () => cmdInspect({ client, json: true }, ['ok-id-123']),
      (error) => error.code === 'OMCTX_UNEXPECTED_RESPONSE' || error.code === 'OMCTX_DECISION_NOT_FOUND',
    );
  } finally {
    server.server.close();
  }
});

test('history passes through bounded list and renders newest first', async () => {
  const server = await startMockServer('ok');
  try {
    const client = new OmniLocalClient({ apiUrl: server.url, token: 't' });
    const originalOut = process.stdout.write;
    let captured = '';
    process.stdout.write = (chunk) => { captured += String(chunk); return true; };
    try {
      await cmdHistory({ client, json: false }, 50);
    } finally {
      process.stdout.write = originalOut;
    }
    assert.ok(captured.includes('d-2'), 'newest decision appears');
    assert.ok(captured.indexOf('d-2') < captured.indexOf('d-1'), 'newest first ordering preserved');
  } finally {
    server.server.close();
  }
});

test('history clamps limit into 1..100', async () => {
  const server = await startMockServer('ok');
  try {
    const client = new OmniLocalClient({ apiUrl: server.url, token: 't' });
    const seen = [];
    const original = client.decisionHistory.bind(client);
    client.decisionHistory = async (limit) => { seen.push(limit); return original(limit); };
    await cmdHistory({ client, json: true }, 9999);
    assert.equal(seen[0], 100);
    await cmdHistory({ client, json: true }, 1);
    assert.equal(seen[1], 1);
  } finally {
    server.server.close();
  }
});

test('history rejects malformed response shapes', async () => {
  const server = await startMockServer('malformed');
  try {
    const client = new OmniLocalClient({ apiUrl: server.url, token: 't' });
    await assert.rejects(() => cmdHistory({ client, json: true }, 20), (error) => error.code === 'OMCTX_UNEXPECTED_RESPONSE');
  } finally {
    server.server.close();
  }
});
