// Omni-Context Background Service Worker
importScripts('privacy.js');

const API_BASE = 'http://127.0.0.1:3001';
const JOB_TIMEOUT_MS = 5 * 60 * 1000;
const FAST_POLL_INTERVAL_MS = 1500;
const FAST_POLL_WINDOW_MS = 25000;
const FALLBACK_ALARM_PERIOD_MINUTES = 1;
const POLL_ALARM_PREFIX = 'poll-';
const PENDING_JOBS_KEY = 'pendingJobs';
const TOKEN_SETUP_DONE_KEY = 'tokenSetupDone';
const CAPTURE_AUDIT_KEY = 'captureAudit';

let desktopConnection = null;
let cachedToken = null;

// --- Token management ---

async function getToken() {
  if (cachedToken) return cachedToken;
  const result = await chrome.storage.local.get('localApiToken');
  cachedToken = result.localApiToken || null;
  return cachedToken;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.localApiToken) return;
  cachedToken = changes.localApiToken.newValue || null;
});

/** 带 token 的 fetch 封装 */
async function apiFetch(path, options = {}) {
  const token = await getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (response.status === 401 && token) {
    cachedToken = null;
    await chrome.storage.local.remove('localApiToken');
  }
  return response;
}

// --- Desktop health ---

async function connectToDesktop() {
  try {
    const response = await apiFetch('/health');
    desktopConnection = {
      status: response.ok ? 'connected' : 'disconnected',
      lastCheck: Date.now(),
    };
  } catch (error) {
    desktopConnection = { status: 'disconnected', lastCheck: Date.now() };
  }
}

// --- Init ---

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({
    settings: OmniPrivacy.migrateSettings(stored.settings),
  });

  chrome.contextMenus.create({
    id: 'capturePage',
    title: 'Capture this page',
    contexts: ['page'],
  });

  chrome.contextMenus.create({
    id: 'captureSelection',
    title: 'Capture selected text',
    contexts: ['selection'],
  });

  connectToDesktop();
});

// Recover pending job polls on SW (re)start
(async function recoverPendingJobs() {
  const jobs = await getPendingJobs();
  const jobIds = Object.keys(jobs);
  if (jobIds.length > 0) {
    console.log('[Omni-Context] Recovering', jobIds.length, 'pending poll(s)');
    for (const jobId of jobIds) {
      chrome.alarms.create(`${POLL_ALARM_PREFIX}${jobId}`, { periodInMinutes: FALLBACK_ALARM_PERIOD_MINUTES });
      startFastPoll(jobId);
    }
  }
})();

// Single alarm listener: health + poll
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'omni-context-health') {
    connectToDesktop();
    return;
  }
  if (alarm.name.startsWith(POLL_ALARM_PREFIX)) {
    const jobId = alarm.name.slice(POLL_ALARM_PREFIX.length);
    handlePoll(jobId);
  }
});

chrome.alarms.create('omni-context-health', { periodInMinutes: 0.5 });

// --- Messages ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_PAGE') {
    capturePage(message.data).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_STATUS') {
    sendResponse(desktopConnection);
    return false;
  }

  if (message.type === 'CAPTURE_SELECTION') {
    captureSelection(message.data, sender.tab).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_PRIVACY_STATE') {
    getPrivacyState(message.url).then(sendResponse);
    return true;
  }
});

// --- Context menus ---

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['privacy.js', 'extractor.js', 'content.js'],
    });
    const type = info.menuItemId === 'captureSelection'
      ? 'PREVIEW_CAPTURE_SELECTION'
      : 'PREVIEW_CAPTURE_PAGE';
    chrome.tabs.sendMessage(tab.id, { type }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[Omni-Context] Context-menu capture could not access the page');
      }
    });
  } catch (error) {
    console.warn('[Omni-Context] Context-menu capture injection failed', error);
  }
});

// --- Capture helpers ---

function formatCaptureText(data) {
  // 对话提取已自带「对话来源/标题/URL」头，直接用原文，避免二次包头
  if (data.preformatted) return (data.content || '').slice(0, 60000);
  return [
    `Type: ${data.type || 'page'}`,
    `URL: ${data.url || ''}`,
    `Title: ${data.title || ''}`,
    '',
    data.content || '',
  ].join('\n').slice(0, 12000);
}

async function getPrivacySettings() {
  const result = await chrome.storage.local.get('settings');
  return OmniPrivacy.mergeSettings(result.settings);
}

async function getPrivacyState(url) {
  const settings = await getPrivacySettings();
  const audit = (await chrome.storage.local.get(CAPTURE_AUDIT_KEY))[CAPTURE_AUDIT_KEY] || [];
  return {
    settings,
    policy: OmniPrivacy.evaluateCapturePolicy(settings, url || '', { automatic: false }),
    lastCapture: audit[0] || null,
  };
}

async function appendAudit(entry) {
  const result = await chrome.storage.local.get(CAPTURE_AUDIT_KEY);
  const audit = Array.isArray(result[CAPTURE_AUDIT_KEY]) ? result[CAPTURE_AUDIT_KEY] : [];
  const item = {
    id: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    ...entry,
  };
  audit.unshift(item);
  await chrome.storage.local.set({ [CAPTURE_AUDIT_KEY]: audit.slice(0, 200) });
  return item.id;
}

async function updateAudit(id, updates) {
  if (!id) return;
  const result = await chrome.storage.local.get(CAPTURE_AUDIT_KEY);
  const audit = Array.isArray(result[CAPTURE_AUDIT_KEY]) ? result[CAPTURE_AUDIT_KEY] : [];
  const index = audit.findIndex((item) => item.id === id);
  if (index < 0) return;
  audit[index] = { ...audit[index], ...updates };
  await chrome.storage.local.set({ [CAPTURE_AUDIT_KEY]: audit });
}

async function prepareCapture(data) {
  const settings = await getPrivacySettings();
  const automatic = data.automatic === true;
  const policy = OmniPrivacy.evaluateCapturePolicy(settings, data.url || '', { automatic });
  if (!policy.allowed) {
    const auditId = await appendAudit({
      domain: policy.domain,
      automatic,
      status: 'blocked',
      reason: policy.reason,
      sentCharacters: 0,
      payloadChunks: 0,
      redactedCount: 0,
    });
    return { ok: false, error: `Capture blocked: ${policy.reason}`, auditId };
  }
  if (!automatic && settings.previewBeforeCapture && data.previewConfirmed !== true) {
    return { ok: false, error: 'Capture preview confirmation is required' };
  }

  const redaction = settings.redactSensitiveFields
    ? OmniPrivacy.redactSensitiveText(data.content || data.text || '')
    : { text: data.content || data.text || '', redactedCount: 0 };
  const prepared = {
    ...data,
    content: redaction.text,
    text: redaction.text,
  };
  const formatted = formatCaptureText(prepared);
  const stats = OmniPrivacy.captureStats(formatted, redaction.redactedCount);
  const auditId = await appendAudit({
    domain: policy.domain,
    source: data.source || (data.selection ? 'selection' : 'page'),
    automatic,
    status: 'submitting',
    ...stats,
  });
  return { ok: true, prepared, formatted, stats, auditId };
}

function textToBase64(str) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function sanitizeFilename(name) {
  return (name || 'untitled')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .substring(0, 100);
}

function splitCaptureText(text) {
  const chunkSize = OmniPrivacy.CAPTURE_CHUNK_CHARACTERS || 12000;
  const value = typeof text === 'string' ? text : '';
  if (!value) return [];
  const chunks = [];
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    chunks.push(value.slice(offset, offset + chunkSize));
  }
  return chunks;
}

// --- Capture entry points ---

async function capturePage(data) {
  const privacy = await prepareCapture(data);
  if (!privacy.ok) return privacy;
  const prefix = data.source ? data.source + '-' : '';
  return submitChunksAndPoll({
    filename: sanitizeFilename(prefix + (data.title || data.url || 'webpage')) + '.txt',
    text: privacy.formatted,
    auditId: privacy.auditId,
    stats: privacy.stats,
  });
}

async function captureSelection(data, tab) {
  const privacy = await prepareCapture({ ...data, selection: true });
  if (!privacy.ok) return privacy;
  const formatted = formatCaptureText({
    type: 'selection',
    url: data.url || tab?.url,
    title: data.title || tab?.title,
    content: privacy.prepared.content,
  });
  const stats = OmniPrivacy.captureStats(formatted, privacy.stats.redactedCount);
  await updateAudit(privacy.auditId, stats);
  return submitChunksAndPoll({
    filename: sanitizeFilename(data.title || tab?.title || 'selection') + '.txt',
    text: formatted,
    auditId: privacy.auditId,
    stats,
  });
}

// --- Async job: submit + fast polling with alarm fallback ---

async function submitChunksAndPoll({ filename, text, auditId, stats }) {
  const chunks = splitCaptureText(text);
  const jobIds = [];
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const suffix = chunks.length > 1
        ? `-part-${String(index + 1).padStart(2, '0')}-of-${String(chunks.length).padStart(2, '0')}`
        : '';
      const dot = filename.lastIndexOf('.');
      const chunkFilename = dot >= 0
        ? `${filename.slice(0, dot)}${suffix}${filename.slice(dot)}`
        : `${filename}${suffix}`;
      const jobId = await submitChunk({
        filename: chunkFilename,
        base64: textToBase64(chunks[index]),
        auditId,
        chunkIndex: index + 1,
        totalChunks: chunks.length,
      });
      jobIds.push(jobId);
    }
  } catch (error) {
    return { ok: false, error: String(error), jobIds, ...stats };
  }
  await updateAudit(auditId, { status: 'queued', jobId: jobIds[0], jobIds });
  return { ok: true, jobId: jobIds[0], jobIds, ...stats };
}

async function submitChunk({ filename, base64, auditId, chunkIndex, totalChunks }) {
  try {
    const res = await apiFetch('/api/ingest/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, contentType: 'text/plain', base64 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);

    const jobId = data.jobId;
    await trackPendingJob(jobId, filename, auditId, chunkIndex, totalChunks);

    chrome.alarms.create(`${POLL_ALARM_PREFIX}${jobId}`, { periodInMinutes: FALLBACK_ALARM_PERIOD_MINUTES });
    startFastPoll(jobId);

    return jobId;
  } catch (error) {
    console.error('[Omni-Context] Ingest submit failed:', error);
    await updateAudit(auditId, { status: 'failed', error: String(error) });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Omni-Context: 提交失败',
      message: error.message || String(error),
    });
    throw error;
  }
}

async function handlePoll(jobId) {
  await pollOnce(jobId);
}

function startFastPoll(jobId) {
  const startedAt = Date.now();

  const tick = async () => {
    const state = await pollOnce(jobId);
    if (state !== 'pending') return;
    if (Date.now() - startedAt >= FAST_POLL_WINDOW_MS) return;
    setTimeout(tick, FAST_POLL_INTERVAL_MS);
  };

  tick();
}

async function pollOnce(jobId) {
  const jobs = await getPendingJobs();
  const jobInfo = jobs[jobId];
  if (!jobInfo) {
    chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
    return 'gone';
  }

  // Timeout
  if (Date.now() - jobInfo.startedAt > JOB_TIMEOUT_MS) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Omni-Context: 处理超时',
      message: '任务仍在后台处理，请稍后在桌面应用查看图谱',
    });
    await untrackPendingJob(jobId);
    chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
    return 'done';
  }

  try {
    const res = await apiFetch(`/api/ingest/job/${jobId}`);
    if (!res.ok) {
      if (res.status === 404) {
        notifyJobError(jobInfo.filename, '任务已过期');
        await untrackPendingJob(jobId);
        chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
        return 'done';
      }
      return 'pending';
    }

    const job = await res.json();

    if (job.status === 'success') {
      const r = job.result || {};
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Omni-Context: 沉淀完成',
        message: `已抽取 ${r.entities || 0} 实体 / ${r.relationships || 0} 关系`,
      });
      await updateAudit(jobInfo.auditId, { status: 'success', result: {
        entities: r.entities || 0,
        relationships: r.relationships || 0,
      } });
      await untrackPendingJob(jobId);
      chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
      return 'done';
    } else if (job.status === 'failed') {
      await updateAudit(jobInfo.auditId, { status: 'failed', error: job.error || 'Processing failed' });
      notifyJobError(jobInfo.filename, job.error || '处理失败');
      await untrackPendingJob(jobId);
      chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
      return 'done';
    }
    // running / queued: keep polling
    return 'pending';
  } catch {
    // Network error — retry on next alarm tick
    return 'pending';
  }
}

function notifyJobError(filename, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Omni-Context: 任务失败',
    message: `${filename}: ${message}`,
  });
}

// --- Pending job persistence (chrome.storage.local) ---

async function getPendingJobs() {
  const result = await chrome.storage.local.get(PENDING_JOBS_KEY);
  return result[PENDING_JOBS_KEY] || {};
}

async function trackPendingJob(jobId, filename, auditId, chunkIndex = 1, totalChunks = 1) {
  const jobs = await getPendingJobs();
  jobs[jobId] = { filename, auditId, chunkIndex, totalChunks, startedAt: Date.now() };
  await chrome.storage.local.set({ [PENDING_JOBS_KEY]: jobs });
}

async function untrackPendingJob(jobId) {
  const jobs = await getPendingJobs();
  delete jobs[jobId];
  await chrome.storage.local.set({ [PENDING_JOBS_KEY]: jobs });
}
