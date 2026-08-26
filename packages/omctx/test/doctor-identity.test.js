import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockServer } from './mock-server.js';
import { OmniLocalClient } from '../src/client/omni-local-client.js';
import { cmdDoctor } from '../src/commands/doctor.js';
import { run } from '../src/cli.js';

async function withTemporaryToken(callback) {
  const originalToken = process.env.OMNI_LOCAL_API_TOKEN;
  process.env.OMNI_LOCAL_API_TOKEN = 'test-token';
  try {
    return await callback();
  } finally {
    if (originalToken === undefined) delete process.env.OMNI_LOCAL_API_TOKEN;
    else process.env.OMNI_LOCAL_API_TOKEN = originalToken;
  }
}

test('doctor fails closed when the health service field is missing', async () => {
  const server = await startMockServer('health-missing-service');
  try {
    const client = new OmniLocalClient({ apiUrl: server.url, token: 'test-token' });
    await assert.rejects(
      () => cmdDoctor({ client, tokenSource: 'environment', json: true, apiUrl: server.url }),
      (error) => error.code === 'OMCTX_WRONG_SERVICE',
    );
  } finally {
    server.server.close();
  }
});

test('doctor rejects an unrelated HTTP 200 health endpoint with OMCTX_WRONG_SERVICE', async () => {
  const server = await startMockServer('wrong-service');
  try {
    const client = new OmniLocalClient({ apiUrl: server.url, token: 'test-token' });
    await assert.rejects(
      () => cmdDoctor({ client, tokenSource: 'environment', json: true, apiUrl: server.url }),
      (error) => error.code === 'OMCTX_WRONG_SERVICE',
    );
    const exitCode = await withTemporaryToken(() => run(['doctor', '--json', '--api-url', server.url]));
    assert.notEqual(exitCode, 0, 'the omctx doctor command must fail for HTTP 200 from an unrelated service');
  } finally {
    server.server.close();
  }
});

test('doctor passes only after exact Omni health identity and authenticated MCP ping', async () => {
  const server = await startMockServer('ok');
  try {
    const exitCode = await withTemporaryToken(() => run(['doctor', '--json', '--api-url', server.url]));
    assert.equal(exitCode, 0);
  } finally {
    server.server.close();
  }
});

test('doctor fails closed on an unsupported control protocol', async () => {
  const server = await startMockServer('unsupported-protocol');
  try {
    const client = new OmniLocalClient({ apiUrl: server.url, token: 'test-token' });
    await assert.rejects(
      () => cmdDoctor({ client, tokenSource: 'environment', json: true, apiUrl: server.url }),
      (error) => error.code === 'OMCTX_UNSUPPORTED_CONTROL_PROTOCOL',
    );
  } finally {
    server.server.close();
  }
});
