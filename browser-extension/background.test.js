const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, 'background.js'), 'utf8');

function loadBackground(initial = {}, fetchImpl = async () => ({ ok: false, status: 404, async json() { return {}; } })) {
  const data = { ...initial };
  const listeners = { storage: null };
  const alarms = [];
  const noopEvent = { addListener() {} };
  const chrome = {
    alarms: { create(name, options) { alarms.push({ name, options }); }, clear() {}, onAlarm: noopEvent },
    contextMenus: { create() {}, onClicked: noopEvent },
    notifications: { create() {} },
    runtime: { onInstalled: noopEvent, onMessage: noopEvent, lastError: null },
    scripting: { async executeScript() { return []; } },
    tabs: { sendMessage() {} },
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return { [key]: data[key] };
          return { ...data };
        },
        async set(values) { Object.assign(data, values); },
        async remove(key) {
          const keys = Array.isArray(key) ? key : [key];
          for (const item of keys) delete data[item];
        },
      },
      onChanged: { addListener(listener) { listeners.storage = listener; } },
    },
  };
  const context = vm.createContext({
    chrome,
    console,
    crypto: require('node:crypto').webcrypto,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    TextEncoder,
    importScripts() {},
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    OmniPrivacy: {
      migrateSettings: (value) => value || {},
      mergeSettings: (value) => value || {},
      evaluateCapturePolicy: () => ({ allowed: true }),
      redactSensitiveText: (value) => ({ text: value, redactedCount: 0 }),
      captureStats: () => ({ characters: 0, chunks: 0, redactedCount: 0 }),
    },
  });
  vm.runInContext(source, context);
  return { context, data, listeners, alarms };
}

test('invalidates the cached token when storage rotates it', async () => {
  const runtime = loadBackground({ localApiToken: 'old-token' });
  assert.equal(await runtime.context.getToken(), 'old-token');
  runtime.data.localApiToken = 'new-token';
  runtime.listeners.storage({ localApiToken: { oldValue: 'old-token', newValue: 'new-token' } }, 'local');
  assert.equal(await runtime.context.getToken(), 'new-token');
});

test('clears a revoked token after an authenticated request returns 401', async () => {
  const runtime = loadBackground(
    { localApiToken: 'revoked-token' },
    async () => ({ ok: false, status: 401, async json() { return {}; } }),
  );
  const response = await runtime.context.apiFetch('/api/stats');
  assert.equal(response.status, 401);
  assert.equal(runtime.data.localApiToken, undefined);
  assert.equal(await runtime.context.getToken(), null);
});

test('restores persisted job polling after service-worker restart', async () => {
  const runtime = loadBackground({
    pendingJobs: { 'job-recover': { filename: 'fixture.txt', auditId: 'audit-1', startedAt: Date.now() } },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.alarms.some((alarm) => alarm.name === 'poll-job-recover'), true);
});

test('splits long captures into bounded transport chunks without dropping text', () => {
  const runtime = loadBackground();
  runtime.context.OmniPrivacy.CAPTURE_CHUNK_CHARACTERS = 5;
  const chunks = Array.from(runtime.context.splitCaptureText('abcdefghijkl'));
  assert.deepEqual(chunks, ['abcde', 'fghij', 'kl']);
  assert.equal(chunks.join(''), 'abcdefghijkl');
});

test('returns a failure response when a revoked token makes chunk submission fail', async () => {
  const runtime = loadBackground();
  const result = await runtime.context.submitChunksAndPoll({
    filename: 'revoked.txt',
    text: 'must fail cleanly',
    auditId: 'audit-revoked',
    stats: { sentCharacters: 17, payloadChunks: 1, redactedCount: 0 },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Server returned 404/);
});
