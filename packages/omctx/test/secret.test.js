import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../src/client/redact.js';
import { startMockServer } from './mock-server.js';
import { OmniLocalClient } from '../src/client/omni-local-client.js';
import { printError, printResult } from '../src/client/output.js';

const SECRETS = [
  'gho_testtokenmKdGz8Z9pA2xT4vB6nQ1sW3eY7uI0oP',
  'github_pat_11ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  'omni-secret-local-token-value-0123456789abcdef',
];

test('redactSecrets scrubs bearer headers and token fields', () => {
  const dirty = [
    'Authorization: Bearer ' + SECRETS[0],
    'Bearer ' + SECRETS[0],
    'GH_TOKEN=' + SECRETS[0],
    'GITHUB_TOKEN=' + SECRETS[0],
    'OMNI_LOCAL_API_TOKEN=' + SECRETS[2],
    '{"authorization": "Bearer ' + SECRETS[0] + '"}',
    '{"token": "' + SECRETS[2] + '"}',
    '{"token_digest": "' + SECRETS[1] + '"}',
    '{"pair_code": "123456"}',
  ].join('\n');
  const clean = redactSecrets(dirty);
  for (const secret of SECRETS) {
    assert.ok(!clean.includes(secret), 'secret must never survive redaction');
  }
});

test('error output never contains tokens from HTTP failures', async () => {
  // Simulate an error path that includes a token in the message; the
  // output layer must scrub it before printing.
  const originalWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => { captured += String(chunk); return true; };
  try {
    printResult({
      command: 'doctor',
      status: 'ok',
      data: { token: SECRETS[2], authorization: 'Bearer ' + SECRETS[0] },
      json: true,
    });
  } finally {
    process.stdout.write = originalWrite;
  }
  for (const secret of SECRETS) {
    assert.ok(!captured.includes(secret), 'stdout must never contain secrets');
  }
});

test('stderr error output is scrubbed', () => {
  const originalWrite = process.stderr.write;
  let captured = '';
  process.stderr.write = (chunk) => { captured += String(chunk); return true; };
  try {
    printError('doctor', { code: 'X', message: 'failed with GH_TOKEN=' + SECRETS[0] }, false);
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.ok(!captured.includes(SECRETS[0]), 'stderr must never contain secrets');
});

test('doctor never prints the token in any mode', async () => {
  const server = await startMockServer('ok');
  const originalOut = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => { captured += String(chunk); return true; };
  try {
    const { cmdDoctor } = await import('../src/commands/doctor.js');
    const client = new OmniLocalClient({ apiUrl: server.url, token: SECRETS[2] });
    const code = await cmdDoctor({ client, json: true, apiUrl: server.url });
    assert.equal(code, 0);
  } finally {
    process.stdout.write = originalOut;
    server.server.close();
  }
  assert.ok(!captured.includes(SECRETS[2]), 'doctor output must never contain the token');
});
