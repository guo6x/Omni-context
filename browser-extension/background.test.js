const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, 'background.js'), 'utf8');
const contentSource = readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const popupSource = readFileSync(path.join(__dirname, 'popup.js'), 'utf8');
const extractorSource = readFileSync(path.join(__dirname, 'extractor.js'), 'utf8');

function loadBackground(initial = {}, fetchImpl = async () => ({ ok: false, status: 404, async json() { return {}; } }), storageOptions = {}) {
  const data = { ...initial };
  const listeners = { storage: null };
  const alarms = [];
  const notifications = [];
  const noopEvent = { addListener() {} };
  const chrome = {
    alarms: { create(name, options) { alarms.push({ name, options }); }, clear() {}, onAlarm: noopEvent },
    contextMenus: { create() {}, onClicked: noopEvent },
    notifications: { create(notification) { notifications.push(notification); } },
    runtime: { onInstalled: noopEvent, onMessage: noopEvent, lastError: null },
    scripting: { async executeScript() { return []; } },
    tabs: { sendMessage() {} },
    storage: {
      local: {
        async get(key) {
          if (typeof key === 'string') return { [key]: data[key] };
          return { ...data };
        },
        async set(values) {
          if (storageOptions.failAutoSigWrites && Object.hasOwn(values, 'autoSig')) {
            throw new Error('Synthetic auto signature storage failure');
          }
          Object.assign(data, values);
        },
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
  return { context, data, listeners, alarms, notifications };
}

function makeCaptureAudit(id, expectedChunks) {
  return {
    id,
    status: 'queued',
    expectedChunks,
    submittedChunks: expectedChunks,
    completedChunks: 0,
    failedChunks: 0,
    jobIds: [],
    settledJobIds: [],
    completedJobIds: [],
    failedJobIds: [],
    result: { entities: 0, relationships: 0 },
  };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

function loadContent(currentConversation, initialStorage = {}, signatureFunction = null) {
  const messages = [];
  const storage = { ...initialStorage, settings: { autoCapture: true, ...(initialStorage.settings || {}) } };
  const conversationUrl = new URL(currentConversation.value.url || 'https://chatgpt.com/c/1');
  const storageWrites = [];
  const timers = new Map();
  let nextTimerId = 1;
  let observer;
  const makeElement = () => ({
    style: {},
    children: [],
    listeners: {},
    setAttribute() {},
    appendChild(child) { this.children.push(child); },
    addEventListener(name, listener) { this.listeners[name] = listener; },
  });
  const document = {
    contentType: 'text/html',
    body: { innerText: '', appendChild() {} },
    getElementById() { return null; },
    createElement: makeElement,
    createElementNS: makeElement,
  };
  const window = {
    confirm() { return true; },
    getSelection() { return { toString() { return ''; } }; },
  };
  window.top = window;
  window.self = window;
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage(message, callback) {
        messages.push(message);
        if (callback) callback({ ok: true, jobId: `queued-${messages.length}` });
      },
    },
    storage: {
      local: {
        async get(key) { return { [key]: storage[key] }; },
        async set(values) { storageWrites.push(values); Object.assign(storage, values); },
      },
      onChanged: { addListener() {} },
    },
  };
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {}
    disconnect() {}
  }
  const context = vm.createContext({
    chrome,
    document,
    window,
    location: {
      hostname: conversationUrl.hostname,
      origin: conversationUrl.origin,
      pathname: conversationUrl.pathname,
      href: conversationUrl.href,
    },
    MutationObserver: FakeMutationObserver,
    OmniPrivacy: {
      mergeSettings: (value) => value || {},
      evaluateCapturePolicy: () => ({ allowed: true }),
      redactSensitiveText: (text) => ({ text, redactedCount: 0 }),
      captureStats: () => ({ sentCharacters: 5, payloadChunks: 1, redactedCount: 0 }),
    },
    __omniExtractConversation: () => currentConversation.value,
    __omniConversationSignature: signatureFunction || (async (conversation) => {
      const marker = conversation.content.includes('changed') ? 'b' : 'a';
      return `${conversation.turns}:${marker.repeat(64)}`;
    }),
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    console,
  });
  vm.runInContext(contentSource, context);
  return { context, messages, storage, storageWrites, timers, get observer() { return observer; } };
}

function loadPopup(currentConversation) {
  const messages = [];
  const notifications = [];
  const storage = { localApiToken: 'fixture-device-token', settings: {} };
  const elements = new Map();
  let domReady;
  const makeElement = (id = '') => ({
    id,
    value: '',
    checked: false,
    textContent: '',
    className: '',
    style: {},
    listeners: {},
    classList: { add() {}, remove() {} },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    appendChild() {},
    remove() {},
  });
  const popupDocument = {
    body: { appendChild(element) { notifications.push(element); } },
    addEventListener(name, listener) { if (name === 'DOMContentLoaded') domReady = listener; },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    createElement: () => makeElement(),
  };
  const pageDocument = {
    title: currentConversation.value.title,
    body: { innerText: currentConversation.value.content },
  };
  const pageContext = vm.createContext({
    location: {
      hostname: 'chatgpt.com',
      origin: 'https://chatgpt.com',
      pathname: '/c/alpha',
      href: 'https://chatgpt.com/c/alpha?tracking=fixture#answer',
    },
    document: pageDocument,
    crypto: require('node:crypto').webcrypto,
    TextEncoder,
    Uint8Array,
    console,
  });
  const tab = { id: 17, url: pageContext.location.href, title: currentConversation.value.title };
  const chrome = {
    storage: {
      local: {
        async get(key) { return { [key]: storage[key] }; },
        async set(values) { Object.assign(storage, values); },
      },
    },
    tabs: { async query() { return [tab]; } },
    scripting: {
      async executeScript(details) {
        if (details.files?.includes('extractor.js')) {
          vm.runInContext(extractorSource, pageContext);
          pageContext.__omniExtractConversation = () => currentConversation.value;
          return [];
        }
        const serialized = details.func.toString();
        const result = await vm.runInContext(`(${serialized})()`, pageContext);
        return [{ result }];
      },
    },
    runtime: {
      async sendMessage(message) {
        messages.push(message);
        if (message.type === 'GET_PRIVACY_STATE') return { lastCapture: null };
        return { ok: true, sentCharacters: 20, payloadChunks: 1 };
      },
    },
  };
  const context = vm.createContext({
    chrome,
    document: popupDocument,
    OmniPrivacy: {
      normalizeDomain: () => 'chatgpt.com',
      mergeSettings: (value) => ({
        autoCapture: false,
        capturePaused: false,
        allowedDomains: [],
        blockedDomains: [],
        redactSensitiveFields: false,
        ...value,
      }),
      evaluateCapturePolicy: () => ({ allowed: true }),
      redactSensitiveText: (text) => ({ text, redactedCount: 0 }),
      captureStats: () => ({ sentCharacters: 20, payloadChunks: 1, redactedCount: 0 }),
    },
    fetch: async () => ({ ok: true, async json() { return { database: { entities: 1, relationships: 2 } }; } }),
    confirm: () => true,
    setTimeout: () => 1,
    console,
  });
  vm.runInContext(popupSource, context);
  return { context, messages, notifications, storage, elements, pageContext, get domReady() { return domReady; } };
}

async function runTimer(runtime, delay) {
  const entry = Array.from(runtime.timers.entries()).find(([, timer]) => timer.delay === delay);
  assert.ok(entry, `expected a scheduled ${delay}ms timer`);
  runtime.timers.delete(entry[0]);
  await entry[1].callback();
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
  const runtime = loadBackground({ captureAudit: [makeCaptureAudit('audit-revoked', 1)] });
  const result = await runtime.context.submitChunksAndPoll({
    filename: 'revoked.txt',
    text: 'must fail cleanly',
    auditId: 'audit-revoked',
    stats: { sentCharacters: 17, payloadChunks: 1, redactedCount: 0 },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Server returned 404/);
  assert.equal(runtime.data.captureAudit[0].status, 'uncertain');
  assert.equal(runtime.data.captureAudit[0].uncertainChunks, 1);
  assert.deepEqual(Array.from(runtime.data.captureAudit[0].unconfirmedChunkIndices), [1]);
  assert.deepEqual(Array.from(runtime.data.captureAudit[0].unconfirmedChunks, (chunk) => ({ ...chunk })), [
    { chunkIndex: 1, status: 'uncertain' },
  ]);
  assert.equal(runtime.notifications.length, 1);
});

test('aggregates out-of-order chunk success before marking the audit and signature complete', async () => {
  const signature = { key: 'https://chat.example/conversation/1', sig: `3:${'a'.repeat(64)}`, count: 3 };
  const runtime = loadBackground({ captureAudit: [makeCaptureAudit('audit-group', 3)] });
  const recordSuccess = (jobId, result) => runtime.context.recordCaptureChunkOutcome(
    jobId,
    { auditId: 'audit-group', filename: `${jobId}.txt`, totalChunks: 3, captureSignature: signature },
    'success',
    { result },
  );

  await recordSuccess('job-3', { entities: 3, relationships: 1 });
  await recordSuccess('job-1', { entities: 2, relationships: 4 });
  assert.equal(runtime.data.captureAudit[0].status, 'queued');
  assert.equal(runtime.data.captureAudit[0].completedChunks, 2);
  assert.equal(runtime.data.autoSig, undefined);

  await Promise.all([
    recordSuccess('job-2', { entities: 5, relationships: 2 }),
    recordSuccess('job-2', { entities: 999, relationships: 999 }),
  ]);
  assert.equal(runtime.data.captureAudit[0].status, 'success');
  assert.equal(runtime.data.captureAudit[0].result.entities, 10);
  assert.equal(runtime.data.captureAudit[0].result.relationships, 7);
  assert.equal(runtime.data.autoSig[signature.key].sig, signature.sig);
  assert.equal(runtime.data.autoSig[signature.key].count, 3);
});

test('waits for every chunk after a failure and preserves aggregate outcomes', async () => {
  const signature = { key: 'https://chat.example/conversation/2', sig: `2:${'b'.repeat(64)}`, count: 2 };
  const runtime = loadBackground({ captureAudit: [makeCaptureAudit('audit-mixed', 3)] });
  const failed = await runtime.context.recordCaptureChunkOutcome(
    'job-1',
    { auditId: 'audit-mixed', filename: 'job-1.txt', totalChunks: 3, captureSignature: signature },
    'failed',
    { error: 'fixture failure' },
  );

  assert.equal(failed.status, 'pending');
  assert.equal(failed.chunkStatus, 'failed');
  assert.equal(runtime.data.captureAudit[0].status, 'queued', 'one failed chunk must not terminalize the group');
  assert.equal(runtime.data.captureAudit[0].completedChunks, 0);
  assert.equal(runtime.data.captureAudit[0].failedChunks, 1);
  assert.deepEqual(Array.from(runtime.data.captureAudit[0].settledJobIds), ['job-1']);

  const firstSuccess = await runtime.context.recordCaptureChunkOutcome(
    'job-2',
    { auditId: 'audit-mixed', filename: 'job-2.txt', totalChunks: 3, captureSignature: signature },
    'success',
    { result: { entities: 4, relationships: 1 } },
  );
  assert.equal(firstSuccess.completedChunks, 1);
  assert.equal(firstSuccess.failedChunks, 1);
  assert.equal(firstSuccess.expectedChunks, 3);
  assert.equal(runtime.data.captureAudit[0].status, 'queued', 'the group remains open until every chunk settles');
  assert.equal(runtime.data.captureAudit[0].completedChunks, 1);
  assert.equal(runtime.data.captureAudit[0].failedChunks, 1);
  assert.deepEqual({ ...runtime.data.captureAudit[0].result }, { entities: 4, relationships: 1 });

  const partial = await runtime.context.recordCaptureChunkOutcome(
    'job-3',
    { auditId: 'audit-mixed', filename: 'job-3.txt', totalChunks: 3, captureSignature: signature },
    'success',
    { result: { entities: 5, relationships: 2 } },
  );

  assert.equal(runtime.data.captureAudit[0].status, 'partial');
  assert.equal(runtime.data.captureAudit[0].error, 'fixture failure');
  assert.equal(runtime.data.captureAudit[0].partial, true);
  assert.equal(runtime.data.captureAudit[0].completedChunks, 2);
  assert.equal(runtime.data.captureAudit[0].failedChunks, 1);
  assert.equal(partial.completedChunks, 2);
  assert.equal(partial.failedChunks, 1);
  assert.equal(partial.expectedChunks, 3);
  assert.deepEqual(Array.from(runtime.data.captureAudit[0].settledJobIds), ['job-1', 'job-2', 'job-3']);
  assert.deepEqual(Array.from(runtime.data.captureAudit[0].failedJobIds), ['job-1']);
  assert.deepEqual({ ...runtime.data.captureAudit[0].result }, { entities: 9, relationships: 3 });
  assert.equal(runtime.data.autoSig, undefined);
});

test('notifies once with aggregate counts when failed then successful chunks finish partially', async () => {
  const chunkJobs = {
    'notice-fail': { status: 'failed', error: 'fixture chunk failure' },
    'notice-success-1': { status: 'success', result: { entities: 4, relationships: 1 } },
    'notice-success-2': { status: 'success', result: { entities: 5, relationships: 2 } },
  };
  const fetchImpl = async (url) => {
    const jobId = String(url).split('/').pop();
    return { ok: true, status: 200, async json() { return chunkJobs[jobId]; } };
  };
  const runtime = loadBackground({ captureAudit: [makeCaptureAudit('audit-notify-partial', 3)] }, fetchImpl);
  runtime.data.pendingJobs = Object.fromEntries(Object.keys(chunkJobs).map((jobId, index) => [jobId, {
    filename: 'partial-capture.txt',
    auditId: 'audit-notify-partial',
    chunkIndex: index + 1,
    totalChunks: 3,
    startedAt: Date.now(),
  }]));

  await runtime.context.pollOnce('notice-fail');
  assert.equal(runtime.notifications.length, 0, 'a failed chunk must not notify before the group settles');
  assert.equal(runtime.data.captureAudit[0].status, 'queued');

  await runtime.context.pollOnce('notice-success-1');
  assert.equal(runtime.notifications.length, 0, 'an intermediate success must not notify before the group settles');

  await runtime.context.pollOnce('notice-success-2');
  assert.equal(runtime.data.captureAudit[0].status, 'partial');
  assert.equal(runtime.notifications.length, 1, 'the partial group should notify exactly once');
  assert.match(runtime.notifications[0].title, /部分完成/);
  assert.match(runtime.notifications[0].message, /2 个分块成功 \/ 1 个失败/);
  assert.match(runtime.notifications[0].message, /已抽取 9 实体 \/ 3 关系/);
});

test('notifies once with a terminal error only after every chunk fails', async () => {
  const chunkJobs = {
    'all-fail-1': { status: 'failed', error: 'first fixture failure' },
    'all-fail-2': { status: 'failed', error: 'second fixture failure' },
    'all-fail-3': { status: 'failed', error: 'third fixture failure' },
  };
  const fetchImpl = async (url) => {
    const jobId = String(url).split('/').pop();
    return { ok: true, status: 200, async json() { return chunkJobs[jobId]; } };
  };
  const runtime = loadBackground({ captureAudit: [makeCaptureAudit('audit-notify-failed', 3)] }, fetchImpl);
  runtime.data.pendingJobs = Object.fromEntries(Object.keys(chunkJobs).map((jobId, index) => [jobId, {
    filename: 'failed-capture.txt',
    auditId: 'audit-notify-failed',
    chunkIndex: index + 1,
    totalChunks: 3,
    startedAt: Date.now(),
  }]));

  await runtime.context.pollOnce('all-fail-1');
  await runtime.context.pollOnce('all-fail-2');
  assert.equal(runtime.notifications.length, 0, 'intermediate failures must wait for final aggregate state');

  await runtime.context.pollOnce('all-fail-3');
  assert.equal(runtime.data.captureAudit[0].status, 'failed');
  assert.equal(runtime.data.captureAudit[0].completedChunks, 0);
  assert.equal(runtime.data.captureAudit[0].failedChunks, 3);
  assert.equal(runtime.notifications.length, 1, 'the all-failed group should notify exactly once');
  assert.match(runtime.notifications[0].title, /任务失败/);
  assert.match(runtime.notifications[0].message, /3 个分块失败 \/ 0 个成功/);
  assert.match(runtime.notifications[0].message, /first fixture failure/);
});

test('partial chunk submission keeps accepted jobs polling and marks unconfirmed chunks uncertain without retry', async () => {
  let submitCount = 0;
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/api/ingest/file')) {
      submitCount += 1;
      if (submitCount === 1) return { ok: true, status: 200, async json() { return { jobId: 'partial-job-1' }; } };
      return { ok: false, status: 503, async json() { return { error: 'fixture submission failure' }; } };
    }
    if (String(url).includes('/api/ingest/job/')) {
      return { ok: true, status: 200, async json() { return { status: 'success', result: { entities: 7, relationships: 2 } }; } };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
  const runtime = loadBackground({ captureAudit: [makeCaptureAudit('audit-partial', 2)] }, fetchImpl);
  runtime.context.OmniPrivacy.CAPTURE_CHUNK_CHARACTERS = 5;
  const signature = { key: 'https://chat.example/conversation/3', sig: `2:${'c'.repeat(64)}`, count: 2 };
  const result = await runtime.context.submitChunksAndPoll({
    filename: 'partial.txt',
    text: 'abcdefghij',
    auditId: 'audit-partial',
    stats: { sentCharacters: 10, payloadChunks: 2, redactedCount: 0 },
    captureSignature: signature,
  });
  await waitFor(() => runtime.data.captureAudit[0].status === 'uncertain', 'accepted jobs should settle while the unconfirmed chunk remains uncertain');

  assert.equal(result.ok, false);
  assert.match(result.error, /fixture submission failure/);
  assert.equal(runtime.data.captureAudit[0].status, 'uncertain');
  assert.equal(runtime.data.captureAudit[0].submissionStatus, 'uncertain');
  assert.equal(runtime.data.captureAudit[0].submittedChunks, 1);
  assert.equal(runtime.data.captureAudit[0].expectedChunks, 2);
  assert.equal(runtime.data.captureAudit[0].uncertainChunks, 1);
  assert.deepEqual(Array.from(runtime.data.captureAudit[0].unconfirmedChunkIndices), [2]);
  assert.deepEqual(Array.from(runtime.data.captureAudit[0].jobIds), ['partial-job-1']);
  assert.equal(runtime.data.captureAudit[0].completedChunks, 1);
  assert.deepEqual({ ...runtime.data.captureAudit[0].result }, { entities: 7, relationships: 2 });
  assert.equal(runtime.data.pendingJobs['partial-job-1'], undefined, 'accepted jobs continue polling to a terminal result');
  assert.equal(submitCount, 2, 'unconfirmed chunks are not automatically re-uploaded');
  assert.equal(runtime.notifications.length, 1, 'submission uncertainty is summarized once after accepted jobs settle');
  assert.match(runtime.notifications[0].title, /待核对/);
  assert.match(runtime.notifications[0].message, /另有 1 个分块状态未确认/);
  assert.equal(runtime.data.autoSig, undefined);
});

test('treats Brain partial as terminal and accurately summarizes grouped partial counts once', async () => {
  const fetchImpl = async (url) => {
    const jobId = String(url).split('/').pop();
    if (jobId === 'brain-partial-job') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { status: 'partial', result: { entities: 6, relationships: 2, failure_count: 1, summary: 'Some source chunks need review' } };
        },
      };
    }
    if (jobId === 'brain-success-job') {
      return { ok: true, status: 200, async json() { return { status: 'success', result: { entities: 5, relationships: 3 } }; } };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
  const runtime = loadBackground({ captureAudit: [makeCaptureAudit('audit-brain-partial', 2)] }, fetchImpl);
  runtime.data.pendingJobs = {
    'brain-partial-job': {
      filename: 'brain-partial.txt',
      auditId: 'audit-brain-partial',
      chunkIndex: 1,
      totalChunks: 2,
      startedAt: Date.now(),
    },
    'brain-success-job': {
      filename: 'brain-success.txt',
      auditId: 'audit-brain-partial',
      chunkIndex: 2,
      totalChunks: 2,
      startedAt: Date.now(),
    },
  };

  const partialState = await runtime.context.pollOnce('brain-partial-job');

  assert.equal(partialState, 'done', 'Brain partial is terminal rather than polled forever');
  assert.equal(runtime.data.captureAudit[0].status, 'queued');
  assert.equal(runtime.data.captureAudit[0].partialChunks, 1);
  assert.equal(runtime.data.pendingJobs['brain-partial-job'], undefined);
  assert.equal(runtime.notifications.length, 0, 'the group waits for all accepted jobs before its summary');

  const successState = await runtime.context.pollOnce('brain-success-job');

  assert.equal(successState, 'done');
  assert.equal(runtime.data.captureAudit[0].status, 'partial');
  assert.equal(runtime.data.captureAudit[0].completedChunks, 1);
  assert.equal(runtime.data.captureAudit[0].partialChunks, 1);
  assert.equal(runtime.data.captureAudit[0].failedChunks, 0);
  assert.equal(runtime.data.captureAudit[0].result.entities, 11);
  assert.equal(runtime.data.captureAudit[0].result.relationships, 5);
  assert.equal(runtime.data.pendingJobs['brain-success-job'], undefined);
  assert.equal(runtime.notifications.length, 1);
  assert.match(runtime.notifications[0].message, /1 个分块成功 \/ 1 个部分完成 \/ 0 个失败/);
  assert.match(runtime.notifications[0].message, /已抽取 11 实体 \/ 5 关系/);
  await runtime.context.pollOnce('brain-partial-job');
  assert.equal(runtime.notifications.length, 1, 're-polling a terminal job does not duplicate the summary');
});

test('recovers an accepted job when the worker stops between pending-job and audit persistence', async () => {
  let postCount = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/api/ingest/file')) {
      postCount += 1;
      return { ok: false, status: 500, async json() { return { error: 'recovery must not submit again' }; } };
    }
    if (String(url).includes('/api/ingest/job/recovered-before-audit')) {
      return { ok: true, status: 200, async json() { return { status: 'success', result: { entities: 3, relationships: 1 } }; } };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
  const runtime = loadBackground({
    captureAudit: [{ ...makeCaptureAudit('audit-restart-window', 2), status: 'submitting', filename: 'restart-window.txt', submittedChunks: 0, jobIds: [] }],
    pendingJobs: {
      'recovered-before-audit': {
        filename: 'restart-window-part-01.txt',
        auditId: 'audit-restart-window',
        chunkIndex: 1,
        totalChunks: 2,
        startedAt: Date.now(),
      },
    },
  }, fetchImpl);

  await waitFor(
    () => runtime.data.captureAudit[0].status === 'uncertain' && !runtime.data.pendingJobs['recovered-before-audit'],
    'startup should reconcile and poll the accepted job, then settle the missing chunk as uncertain',
  );

  assert.equal(runtime.data.captureAudit[0].submittedChunks, 1);
  assert.equal(runtime.data.captureAudit[0].completedChunks, 1);
  assert.equal(runtime.data.captureAudit[0].uncertainChunks, 1);
  assert.deepEqual(Array.from(runtime.data.captureAudit[0].jobIds), ['recovered-before-audit']);
  assert.deepEqual(Array.from(runtime.data.captureAudit[0].unconfirmedChunkIndices), [2]);
  assert.deepEqual({ ...runtime.data.captureAudit[0].result }, { entities: 3, relationships: 1 });
  assert.equal(postCount, 0, 'recovery resumes polling only and never re-uploads unconfirmed chunks');
  assert.equal(runtime.notifications.length, 1);
});

test('recovers a queued incomplete group after an accepted chunk and before the next upload', async () => {
  let postCount = 0;
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/api/ingest/file')) {
      postCount += 1;
      return { ok: false, status: 500, async json() { return { error: 'recovery must not submit the missing chunk' }; } };
    }
    if (String(url).includes('/api/ingest/job/queued-accepted-job')) {
      return { ok: true, status: 200, async json() { return { status: 'success', result: { entities: 4, relationships: 2 } }; } };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
  const runtime = loadBackground({
    captureAudit: [{
      ...makeCaptureAudit('audit-queued-incomplete', 2),
      status: 'queued',
      filename: 'queued-incomplete.txt',
      submittedChunks: 1,
      jobIds: ['queued-accepted-job'],
    }],
    pendingJobs: {
      'queued-accepted-job': {
        filename: 'queued-incomplete-part-01.txt',
        auditId: 'audit-queued-incomplete',
        chunkIndex: 1,
        totalChunks: 2,
        startedAt: Date.now(),
      },
    },
  }, fetchImpl);

  await waitFor(
    () => runtime.data.captureAudit[0].status === 'uncertain' && !runtime.data.pendingJobs['queued-accepted-job'],
    'startup should recover the accepted chunk and settle the unsubmitted chunk as uncertain',
  );

  assert.equal(runtime.data.captureAudit[0].submittedChunks, 1);
  assert.equal(runtime.data.captureAudit[0].expectedChunks, 2);
  assert.equal(runtime.data.captureAudit[0].completedChunks, 1);
  assert.equal(runtime.data.captureAudit[0].failedChunks, 0);
  assert.equal(runtime.data.captureAudit[0].uncertainChunks, 1);
  assert.deepEqual(Array.from(runtime.data.captureAudit[0].jobIds), ['queued-accepted-job']);
  assert.deepEqual(Array.from(runtime.data.captureAudit[0].unconfirmedChunkIndices), [2]);
  assert.deepEqual({ ...runtime.data.captureAudit[0].result }, { entities: 4, relationships: 2 });
  assert.equal(postCount, 0, 'the worker polls accepted work but never re-uploads the missing chunk');
  assert.equal(runtime.notifications.length, 1, 'the interrupted group produces one final summary');
  assert.match(runtime.notifications[0].title, /部分完成.*待核对/);
  assert.match(runtime.notifications[0].message, /1 个成功 \/ 0 个部分完成 \/ 0 个失败/);
  assert.match(runtime.notifications[0].message, /另有 1 个分块状态未确认/);
});

test('suppresses automatic re-upload of a persisted uncertain capture signature', async () => {
  let postCount = 0;
  const signature = { key: 'https://chat.example/conversation/uncertain', sig: `2:${'f'.repeat(64)}`, count: 2 };
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/api/ingest/file')) postCount += 1;
    return { ok: false, status: 503, async json() { return { error: 'automatic re-upload is not expected' }; } };
  };
  const runtime = loadBackground({
    captureAudit: [{
      ...makeCaptureAudit('audit-uncertain-reload', 2),
      status: 'uncertain',
      submissionStatus: 'uncertain',
      captureSignature: signature,
    }],
  }, fetchImpl);

  const result = await runtime.context.capturePage({
    url: signature.key,
    title: 'Uncertain conversation',
    content: 'Previously captured content',
    source: 'ChatGPT',
    turns: signature.count,
    automatic: true,
    captureSignature: signature,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'uncertain');
  assert.match(result.error, /automatic re-upload is suppressed/i);
  assert.equal(postCount, 0, 'a new content-script instance must not re-upload the uncertain signature');
});

test('restores chunk aggregation across a service-worker restart', async () => {
  const signature = { key: 'https://chat.example/conversation/4', sig: `4:${'d'.repeat(64)}`, count: 4 };
  const initial = {
    captureAudit: [{ ...makeCaptureAudit('audit-restart', 2), jobIds: ['recover-1', 'recover-2'] }],
    pendingJobs: {
      'recover-1': { filename: 'recover-1.txt', auditId: 'audit-restart', chunkIndex: 1, totalChunks: 2, startedAt: Date.now(), captureSignature: signature },
    },
  };
  const successFetch = async (url) => String(url).includes('/api/ingest/job/')
    ? { ok: true, status: 200, async json() { return { status: 'success', result: { entities: 2, relationships: 3 } }; } }
    : { ok: false, status: 404, async json() { return {}; } };
  const firstWorker = loadBackground(initial, successFetch);
  await waitFor(
    () => firstWorker.data.captureAudit[0].completedChunks === 1 && !firstWorker.data.pendingJobs['recover-1'],
    'first worker should persist the first chunk result before stopping',
  );
  assert.equal(firstWorker.data.captureAudit[0].status, 'queued');
  assert.equal(firstWorker.data.autoSig, undefined);

  firstWorker.data.pendingJobs['recover-2'] = {
    filename: 'recover-2.txt', auditId: 'audit-restart', chunkIndex: 2, totalChunks: 2,
    startedAt: Date.now(), captureSignature: signature,
  };
  const restartedWorker = loadBackground(firstWorker.data, successFetch);
  await waitFor(() => restartedWorker.data.captureAudit[0].status === 'success', 'restarted worker should finish the recovered chunk group');

  assert.equal(restartedWorker.data.captureAudit[0].result.entities, 4);
  assert.equal(restartedWorker.data.captureAudit[0].result.relationships, 6);
  assert.equal(restartedWorker.data.autoSig[signature.key].sig, signature.sig);
  assert.equal(restartedWorker.data.autoSig[signature.key].count, 4);
});

test('replays a terminal success after restart to finish an interrupted signature write', async () => {
  const signature = { key: 'https://chat.example/conversation/replay', sig: `5:${'e'.repeat(64)}`, count: 5 };
  const audit = {
    ...makeCaptureAudit('audit-signature-replay', 1),
    status: 'success',
    settledJobIds: ['replay-job'],
    completedJobIds: ['replay-job'],
    completedChunks: 1,
    result: { entities: 3, relationships: 2 },
  };
  const jobInfo = {
    filename: 'replay.txt',
    auditId: audit.id,
    chunkIndex: 1,
    totalChunks: 1,
    startedAt: Date.now(),
    captureSignature: signature,
  };
  const successFetch = async (url) => String(url).includes('/api/ingest/job/')
    ? { ok: true, status: 200, async json() { return { status: 'success', result: { entities: 3, relationships: 2 } }; } }
    : { ok: false, status: 404, async json() { return {}; } };
  const interruptedWrite = loadBackground(
    { captureAudit: [audit] },
    successFetch,
    { failAutoSigWrites: true },
  );
  interruptedWrite.data.pendingJobs = { 'replay-job': jobInfo };

  await interruptedWrite.context.pollOnce('replay-job');

  assert.equal(interruptedWrite.data.captureAudit[0].status, 'success');
  assert.equal(interruptedWrite.data.autoSig, undefined);
  assert.ok(interruptedWrite.data.pendingJobs['replay-job'], 'the signature-bearing pending receipt must remain retryable');

  const restartedWorker = loadBackground(interruptedWrite.data, successFetch);
  await waitFor(
    () => !restartedWorker.data.pendingJobs?.['replay-job'] && restartedWorker.data.autoSig?.[signature.key],
    'a restarted worker should replay terminal success and commit the missing signature',
  );

  assert.equal(restartedWorker.data.autoSig[signature.key].sig, signature.sig);
  assert.equal(restartedWorker.data.autoSig[signature.key].count, signature.count);
  assert.equal(restartedWorker.data.captureAudit[0].status, 'success');
  assert.equal(restartedWorker.notifications.length, 0, 'replay should not emit a duplicate completion notification');

  const replay = await restartedWorker.context.recordCaptureChunkOutcome(
    'replay-job', jobInfo, 'success', { result: { entities: 3, relationships: 2 } },
  );
  assert.equal(replay.status, 'replayed');
  assert.equal(restartedWorker.data.autoSig[signature.key].sig, signature.sig);
});

test('timeout and expired-job responses fail the whole capture group', async () => {
  const timeoutRuntime = loadBackground({ captureAudit: [makeCaptureAudit('audit-timeout', 1)] });
  timeoutRuntime.data.pendingJobs = {
    'job-timeout': {
      filename: 'timeout.txt', auditId: 'audit-timeout', chunkIndex: 1, totalChunks: 1,
      startedAt: Date.now() - 6 * 60 * 1000,
    },
  };
  await timeoutRuntime.context.pollOnce('job-timeout');
  assert.equal(timeoutRuntime.data.captureAudit[0].status, 'failed');
  assert.match(timeoutRuntime.data.captureAudit[0].error, /timed out/i);

  const expiredRuntime = loadBackground({ captureAudit: [makeCaptureAudit('audit-expired', 1)] });
  expiredRuntime.data.pendingJobs = {
    'job-expired': {
      filename: 'expired.txt', auditId: 'audit-expired', chunkIndex: 1, totalChunks: 1,
      startedAt: Date.now(),
    },
  };
  await expiredRuntime.context.pollOnce('job-expired');
  assert.equal(expiredRuntime.data.captureAudit[0].status, 'failed');
  assert.equal(expiredRuntime.data.captureAudit[0].error, '任务已过期');
});

test('a single processing failure keeps its one terminal error notification', async () => {
  const runtime = loadBackground(
    { captureAudit: [makeCaptureAudit('audit-single-failure', 1)] },
    async () => ({ ok: true, status: 200, async json() { return { status: 'failed', error: 'single fixture failure' }; } }),
  );
  runtime.data.pendingJobs = {
    'single-failed-job': {
      filename: 'single.txt',
      auditId: 'audit-single-failure',
      chunkIndex: 1,
      totalChunks: 1,
      startedAt: Date.now(),
    },
  };

  await runtime.context.pollOnce('single-failed-job');

  assert.equal(runtime.data.captureAudit[0].status, 'failed');
  assert.equal(runtime.notifications.length, 1);
  assert.match(runtime.notifications[0].title, /任务失败/);
  assert.match(runtime.notifications[0].message, /1 个分块失败 \/ 0 个成功/);
  assert.match(runtime.notifications[0].message, /single fixture failure/);
});

test('automatic capture retries changed content but does not loop on a failed signature', async () => {
  const conversation = {
    value: {
      url: 'https://chatgpt.com/c/1', title: 'Fixture', content: 'original body', source: 'ChatGPT', turns: 1, lastRole: 'assistant',
    },
  };
  const runtime = loadContent(conversation);
  await new Promise((resolve) => setImmediate(resolve));

  await runTimer(runtime, 3500);
  assert.equal(runtime.messages.length, 1);
  assert.equal(runtime.messages[0].data.captureSignature.sig, `1:${'a'.repeat(64)}`);
  runtime.observer.callback();
  await runTimer(runtime, 3500);
  assert.equal(runtime.messages.length, 1, 'same content should not be automatically resubmitted');

  conversation.value = { ...conversation.value, content: 'changed body' };
  runtime.observer.callback();
  await runTimer(runtime, 3500);
  assert.equal(runtime.messages.length, 2, 'changed content should be eligible for a new capture');
  assert.equal(runtime.messages[1].data.captureSignature.sig, `1:${'b'.repeat(64)}`);
  assert.equal(runtime.storage.autoSig, undefined, 'content script must not commit a signature at queue acknowledgement');
  assert.equal(runtime.storageWrites.some((entry) => Object.hasOwn(entry, 'autoSig')), false);
});

test('manual popup capture commits the extractor signature and suppresses a later automatic duplicate', async () => {
  const conversation = {
    value: {
      url: 'https://chatgpt.com/c/alpha?tracking=fixture#answer',
      title: 'Alpha fixture conversation',
      source: 'ChatGPT',
      turns: 2,
      lastRole: 'assistant',
      content: '【我】\nShould I continue the project?\n\n【ChatGPT】\nReview the existing evidence first.',
    },
  };
  const popup = loadPopup(conversation);
  await popup.domReady();
  await popup.elements.get('capturePageBtn').listeners.click();

  const message = popup.messages.find((entry) => entry.type === 'CAPTURE_PAGE');
  assert.ok(message, 'the popup should submit the selected conversation');
  const expectedSignature = await popup.pageContext.__omniConversationSignature(conversation.value);
  assert.equal(message.data.captureSignature.key, 'https://chatgpt.com/c/alpha');
  assert.equal(message.data.captureSignature.sig, expectedSignature);
  assert.equal(message.data.captureSignature.count, conversation.value.turns);
  assert.match(message.data.captureSignature.sig, /^2:[a-f0-9]{64}$/);

  const background = loadBackground({ captureAudit: [makeCaptureAudit('popup-capture', 1)] });
  await background.context.recordCaptureChunkOutcome(
    'popup-job-1',
    {
      auditId: 'popup-capture',
      filename: 'popup-capture.txt',
      totalChunks: 1,
      captureSignature: message.data.captureSignature,
    },
    'success',
    { result: { entities: 2, relationships: 1 } },
  );
  assert.equal(background.data.captureAudit[0].status, 'success');
  assert.equal(background.data.autoSig[message.data.captureSignature.key].sig, expectedSignature);

  const content = loadContent(
    conversation,
    { autoSig: background.data.autoSig },
    (data) => popup.pageContext.__omniConversationSignature(data),
  );
  await new Promise((resolve) => setImmediate(resolve));
  await runTimer(content, 3500);
  assert.equal(content.messages.length, 0, 'automatic capture should recognize the popup-committed signature');
});
