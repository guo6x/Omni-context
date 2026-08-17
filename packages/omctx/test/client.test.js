import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServer } from './mock-server.js';
import { OmniLocalClient, assertLoopbackUrl } from '../src/client/omni-local-client.js';
import { OmctxError } from '../src/client/errors.js';

let current;
afterEach(() => { if (current) current.server.close(); current = null; });

test('valid token: health + ping succeed', async () => {
  current = await startMockServer('ok');
  const client = new OmniLocalClient({ apiUrl: current.url, token: 'test-token' });
  const health = await client.health();
  assert.equal(health.ok, true);
  await client.mcpPing();
});

test('401 -> OMCTX_AUTH_REJECTED', async () => {
  current = await startMockServer('unauthorized');
  const client = new OmniLocalClient({ apiUrl: current.url, token: 'wrong' });
  await assert.rejects(() => client.mcpPing(), (error) => error instanceof OmctxError && error.code === 'OMCTX_AUTH_REJECTED');
});

test('403 -> OMCTX_AUTH_REJECTED', async () => {
  current = await startMockServer('forbidden');
  const client = new OmniLocalClient({ apiUrl: current.url, token: 'wrong' });
  await assert.rejects(() => client.mcpPing(), (error) => error.code === 'OMCTX_AUTH_REJECTED');
});

test('500 -> OMCTX_BRAIN_OFFLINE', async () => {
  current = await startMockServer('error500');
  const client = new OmniLocalClient({ apiUrl: current.url, token: 't' });
  await assert.rejects(() => client.mcpPing(), (error) => error.code === 'OMCTX_BRAIN_OFFLINE');
});

test('malformed JSON -> OMCTX_UNEXPECTED_RESPONSE', async () => {
  current = await startMockServer('malformed');
  const client = new OmniLocalClient({ apiUrl: current.url, token: 't' });
  await assert.rejects(() => client.health(), (error) => error.code === 'OMCTX_UNEXPECTED_RESPONSE');
});

test('timeout -> OMCTX_BRAIN_OFFLINE', async () => {
  current = await startMockServer('slow');
  const client = new OmniLocalClient({ apiUrl: current.url, token: 't', timeoutMs: 200 });
  await assert.rejects(() => client.mcpPing(), (error) => error.code === 'OMCTX_BRAIN_OFFLINE');
});

test('connection refused -> OMCTX_BRAIN_OFFLINE', async () => {
  const client = new OmniLocalClient({ apiUrl: 'http://127.0.0.1:1', token: 't', timeoutMs: 1000 });
  await assert.rejects(() => client.mcpPing(), (error) => error.code === 'OMCTX_BRAIN_OFFLINE');
});

test('remote URL rejected (LAN + hostname + https)', () => {
  for (const url of ['http://192.168.1.50:3001', 'http://example.com:3001', 'https://127.0.0.1:3001', 'http://10.0.0.2']) {
    assert.throws(() => assertLoopbackUrl(url), (error) => error.code === 'OMCTX_REMOTE_API_NOT_SUPPORTED_IN_ALPHA', url);
  }
});

test('loopback URLs accepted', () => {
  for (const url of ['http://127.0.0.1:3001', 'http://localhost:3001', 'http://[::1]:3001']) {
    assert.doesNotThrow(() => assertLoopbackUrl(url), url);
  }
});

test('redirect to remote host is rejected (never followed)', async () => {
  current = await startMockServer('redirect-remote');
  const client = new OmniLocalClient({ apiUrl: current.url, token: 't' });
  await assert.rejects(() => client.health(), (error) => error.code === 'OMCTX_BRAIN_OFFLINE');
});

test('client sends Bearer + X-Omni-Client headers', async () => {
  let capturedAuth = null;
  let capturedClient = null;
  current = await startMockServer('ok', (req) => {
    if (req.url === '/mcp') {
      capturedAuth = req.headers.authorization;
      capturedClient = req.headers['x-omni-client'];
    }
  });
  const client = new OmniLocalClient({ apiUrl: current.url, token: 'my-secret-token' });
  await client.mcpPing();
  assert.equal(capturedAuth, 'Bearer my-secret-token');
  assert.equal(capturedClient, 'omctx/0.1.0-alpha.0');
});

test('non-allowlisted tool is rejected locally and never sent', async () => {
  let requestCount = 0;
  current = await startMockServer('ok', () => { requestCount += 1; });
  const client = new OmniLocalClient({ apiUrl: current.url, token: 't' });
  await assert.rejects(
    () => client.callAllowlistedReadTool('save_decision', { conclusion: 'x' }),
    (error) => error.code === 'CLI_READ_TOOL_NOT_ALLOWED',
  );
  await assert.rejects(
    () => client.callAllowlistedReadTool('record_decision_outcome', {}),
    (error) => error.code === 'CLI_READ_TOOL_NOT_ALLOWED',
  );
  await assert.rejects(
    () => client.callAllowlistedReadTool('update_entity', {}),
    (error) => error.code === 'CLI_READ_TOOL_NOT_ALLOWED',
  );
  await assert.rejects(
    () => client.callAllowlistedReadTool('delete_entity', {}),
    (error) => error.code === 'CLI_READ_TOOL_NOT_ALLOWED',
  );
  await assert.rejects(
    () => client.callAllowlistedReadTool('totally_unknown_tool', {}),
    (error) => error.code === 'CLI_READ_TOOL_NOT_ALLOWED',
  );
  assert.equal(requestCount, 0, 'no request may leave the CLI for disallowed tools');
});
