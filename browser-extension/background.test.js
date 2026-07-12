const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, 'background.js'), 'utf8');

function loadBackground(initial = {}) {
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
      },
      onChanged: { addListener(listener) { listeners.storage = listener; } },
    },
  };
  const context = vm.createContext({
    chrome,
    console,
    crypto: require('node:crypto').webcrypto,
    fetch: async () => ({ ok: false, status: 404, async json() { return {}; } }),
    setTimeout,
    clearTimeout,
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

test('restores persisted job polling after service-worker restart', async () => {
  const runtime = loadBackground({
    pendingJobs: { 'job-recover': { filename: 'fixture.txt', auditId: 'audit-1', startedAt: Date.now() } },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.alarms.some((alarm) => alarm.name === 'poll-job-recover'), true);
});
