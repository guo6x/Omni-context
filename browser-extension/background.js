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
let captureAuditMutationQueue = Promise.resolve();
let pendingJobsMutationQueue = Promise.resolve();
let autoSignatureMutationQueue = Promise.resolve();

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

// Recover pending job polls on SW (re)start before accepting new capture submissions.
const pendingJobRecovery = (async function recoverPendingJobs() {
  const jobs = await getPendingJobs();
  const jobIds = Object.keys(jobs);
  await recoverInterruptedCaptureSubmissions(jobs);
  if (jobIds.length > 0) {
    console.log('[Omni-Context] Recovering', jobIds.length, 'pending poll(s)');
    for (const jobId of jobIds) {
      chrome.alarms.create(`${POLL_ALARM_PREFIX}${jobId}`, { periodInMinutes: FALLBACK_ALARM_PERIOD_MINUTES });
      startFastPoll(jobId);
    }
  }
})().catch((error) => {
  console.warn('[Omni-Context] Pending capture recovery did not complete', error);
});

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
    pendingJobRecovery.then(() => capturePage(message.data)).then(sendResponse);
    return true;
  }

  if (message.type === 'GET_STATUS') {
    sendResponse(desktopConnection);
    return false;
  }

  if (message.type === 'CAPTURE_SELECTION') {
    pendingJobRecovery.then(() => captureSelection(message.data, sender.tab)).then(sendResponse);
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
  return mutateCaptureAudit((audit) => {
    const item = {
      id: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      ...entry,
    };
    audit.unshift(item);
    audit.length = Math.min(audit.length, 200);
    return item.id;
  });
}

async function updateAudit(id, updates) {
  if (!id) return;
  return mutateCaptureAudit((audit) => {
    const index = audit.findIndex((item) => item.id === id);
    if (index < 0) return false;
    audit[index] = { ...audit[index], ...updates };
    return true;
  });
}

function mutateCaptureAudit(mutate) {
  const task = captureAuditMutationQueue.then(async () => {
    const result = await chrome.storage.local.get(CAPTURE_AUDIT_KEY);
    const audit = Array.isArray(result[CAPTURE_AUDIT_KEY]) ? [...result[CAPTURE_AUDIT_KEY]] : [];
    const value = await mutate(audit);
    await chrome.storage.local.set({ [CAPTURE_AUDIT_KEY]: audit });
    return value;
  });
  captureAuditMutationQueue = task.catch(() => {});
  return task;
}

function isTerminalCaptureStatus(status) {
  return ['success', 'failed', 'partial', 'uncertain', 'blocked'].includes(status);
}

function normalizeCaptureSignature(value) {
  if (!value || typeof value !== 'object') return null;
  const { key, sig, count } = value;
  if (typeof key !== 'string' || key.length === 0 || key.length > 2048) return null;
  if (typeof sig !== 'string' || !/^\d+:[a-f0-9]{64}$/i.test(sig)) return null;
  if (!Number.isSafeInteger(count) || count < 0) return null;
  return { key, sig, count };
}

async function commitCaptureSignature(value) {
  const signature = normalizeCaptureSignature(value);
  if (!signature) return false;
  const task = autoSignatureMutationQueue.then(async () => {
    const result = await chrome.storage.local.get('autoSig');
    const map = result.autoSig && typeof result.autoSig === 'object' && !Array.isArray(result.autoSig)
      ? { ...result.autoSig }
      : {};
    map[signature.key] = { sig: signature.sig, count: signature.count };
    const keys = Object.keys(map);
    while (keys.length > 200) delete map[keys.shift()];
    await chrome.storage.local.set({ autoSig: map });
    return true;
  });
  autoSignatureMutationQueue = task.catch(() => {});
  return task;
}

async function hasUncertainCaptureSignature(value) {
  const signature = normalizeCaptureSignature(value);
  if (!signature) return false;
  const stored = await chrome.storage.local.get(CAPTURE_AUDIT_KEY);
  const audit = Array.isArray(stored[CAPTURE_AUDIT_KEY]) ? stored[CAPTURE_AUDIT_KEY] : [];
  return audit.some((entry) => {
    const previous = normalizeCaptureSignature(entry.captureSignature);
    return entry.submissionStatus === 'uncertain'
      && previous?.key === signature.key
      && previous.sig === signature.sig
      && previous.count === signature.count;
  });
}

async function updateQueuedCaptureAudit(id, updates) {
  if (!id) return;
  return mutateCaptureAudit((audit) => {
    const index = audit.findIndex((item) => item.id === id);
    if (index < 0 || isTerminalCaptureStatus(audit[index].status)) return false;
    audit[index] = { ...audit[index], ...updates };
    return true;
  });
}

async function failCaptureGroup(id, error, { jobIds = [], expectedChunks = 0 } = {}) {
  if (!id) return false;
  return mutateCaptureAudit((audit) => {
    const index = audit.findIndex((item) => item.id === id);
    if (index < 0 || isTerminalCaptureStatus(audit[index].status)) return false;
    audit[index] = {
      ...audit[index],
      status: 'failed',
      error: String(error),
      partial: jobIds.length > 0,
      expectedChunks,
      submittedChunks: jobIds.length,
      jobIds,
    };
    return true;
  });
}

async function markCaptureSubmissionUncertain(id, error, { jobIds = [], expectedChunks = 0, unconfirmedChunkIndices = [] } = {}) {
  if (!id) return { status: 'ignored' };
  return mutateCaptureAudit((audit) => {
    const index = audit.findIndex((item) => item.id === id);
    if (index < 0 || isTerminalCaptureStatus(audit[index].status)) return { status: 'ignored' };
    const current = audit[index];
    const acceptedJobIds = [...new Set([
      ...(Array.isArray(current.jobIds) ? current.jobIds : []),
      ...jobIds,
    ])];
    const settledJobIds = Array.isArray(current.settledJobIds) ? current.settledJobIds : [];
    const completedJobIds = Array.isArray(current.completedJobIds) ? current.completedJobIds : [];
    const failedJobIds = Array.isArray(current.failedJobIds) ? current.failedJobIds : [];
    const partialJobIds = Array.isArray(current.partialJobIds) ? current.partialJobIds : [];
    const uncertainChunks = unconfirmedChunkIndices.length;
    const acceptedJobsSettled = settledJobIds.length >= acceptedJobIds.length;
    const status = acceptedJobsSettled ? 'uncertain' : 'queued';
    audit[index] = {
      ...current,
      status,
      error: current.error || String(error),
      submissionStatus: 'uncertain',
      submissionError: String(error),
      submittedChunks: acceptedJobIds.length,
      expectedChunks,
      jobIds: [...acceptedJobIds],
      uncertainChunks,
      unconfirmedChunks: unconfirmedChunkIndices.map((chunkIndex) => ({ chunkIndex, status: 'uncertain' })),
      unconfirmedChunkIndices: [...unconfirmedChunkIndices],
      partial: completedJobIds.length > 0 && failedJobIds.length > 0,
    };
    if (status !== 'uncertain') return { status: 'pending' };
    return {
      status,
      filename: current.filename,
      completedChunks: completedJobIds.length,
      partialChunks: partialJobIds.length,
      failedChunks: failedJobIds.length,
      uncertainChunks,
      expectedChunks,
      submittedChunks: acceptedJobIds.length,
      error: String(error),
      result: current.result || { entities: 0, relationships: 0 },
    };
  });
}

async function recoverInterruptedCaptureSubmissions(pendingJobs) {
  const stored = await chrome.storage.local.get(CAPTURE_AUDIT_KEY);
  const audits = Array.isArray(stored[CAPTURE_AUDIT_KEY]) ? stored[CAPTURE_AUDIT_KEY] : [];
  for (const audit of audits) {
    if (!['submitting', 'queued'].includes(audit.status) || audit.submissionStatus === 'uncertain') continue;
    const acceptedJobs = Object.entries(pendingJobs)
      .filter(([, jobInfo]) => jobInfo?.auditId === audit.id)
      .map(([jobId]) => jobId);
    const acceptedJobIds = [...new Set([...(Array.isArray(audit.jobIds) ? audit.jobIds : []), ...acceptedJobs])];
    const acceptedCount = Math.max(
      acceptedJobIds.length,
      Number(audit.submittedChunks) || 0,
    );
    const expectedChunks = Number(audit.expectedChunks) || acceptedCount;
    if (acceptedCount >= expectedChunks) {
      if (audit.status === 'submitting') {
        await updateQueuedCaptureAudit(audit.id, {
          status: 'queued',
          submittedChunks: acceptedCount,
          jobIds: acceptedJobIds,
        });
      }
      continue;
    }
    const unconfirmedChunkIndices = Array.from(
      { length: Math.max(0, expectedChunks - acceptedCount) },
      (_, offset) => acceptedCount + offset + 1,
    );
    const outcome = await markCaptureSubmissionUncertain(audit.id, 'Capture worker restarted during chunk submission', {
      jobIds: acceptedJobs,
      expectedChunks,
      unconfirmedChunkIndices,
    });
    if (outcome.status === 'uncertain') {
      const pendingFilename = acceptedJobs.map((jobId) => pendingJobs[jobId]?.filename).find(Boolean);
      notifyCaptureOutcome(outcome, audit.filename || pendingFilename || 'Capture');
    }
  }
}

function finalCaptureGroupStatus(completedChunks, partialChunks, failedChunks, uncertainChunks = 0) {
  if (uncertainChunks > 0) return 'uncertain';
  if (partialChunks > 0 || (completedChunks > 0 && failedChunks > 0)) return 'partial';
  return failedChunks > 0 ? 'failed' : 'success';
}

async function recordCaptureChunkOutcome(jobId, jobInfo, status, details = {}) {
  const auditId = jobInfo?.auditId;
  if (!auditId) return { status: 'ignored' };
  let signatureToCommit = null;
  const outcome = await mutateCaptureAudit((audit) => {
    const index = audit.findIndex((item) => item.id === auditId);
    if (index < 0) return { status: 'ignored' };
    const current = audit[index];
    if (isTerminalCaptureStatus(current.status)) {
      // The audit and autoSig are persisted separately. If the worker stopped
      // between those writes, the pending job is the durable signature receipt
      // that lets a replay finish deduplication without changing the audit.
      if (current.status === 'success' && normalizeCaptureSignature(jobInfo.captureSignature)) {
        signatureToCommit = jobInfo.captureSignature;
        return {
          status: 'replayed',
          filename: jobInfo.filename,
          completedChunks: Number(current.completedChunks) || 0,
          partialChunks: Number(current.partialChunks) || 0,
          failedChunks: Number(current.failedChunks) || 0,
          expectedChunks: Number(current.expectedChunks) || Number(jobInfo.totalChunks) || 1,
          uncertainChunks: Number(current.uncertainChunks) || 0,
          error: current.error,
          result: current.result || {},
        };
      }
      return { status: 'ignored' };
    }

    const settledJobIds = Array.isArray(current.settledJobIds) ? current.settledJobIds : [];
    if (settledJobIds.includes(jobId)) return { status: 'ignored' };
    const nextSettledJobIds = [...settledJobIds, jobId];
    const completedJobIds = Array.isArray(current.completedJobIds) ? current.completedJobIds : [];
    const partialJobIds = Array.isArray(current.partialJobIds) ? current.partialJobIds : [];
    const failedJobIds = Array.isArray(current.failedJobIds) ? current.failedJobIds : [];
    const expectedChunks = Number(current.expectedChunks) || Number(jobInfo.totalChunks) || 1;
    const uncertainChunks = Number(current.uncertainChunks) || 0;
    const submittedChunks = Number(current.submittedChunks) || (Array.isArray(current.jobIds) ? current.jobIds.length : 0);
    const settlementTarget = current.submissionStatus === 'uncertain' ? submittedChunks : expectedChunks;
    const groupComplete = settlementTarget > 0 && nextSettledJobIds.length >= settlementTarget;

    if (status === 'failed') {
      const nextFailedJobIds = [...failedJobIds, jobId];
      const finalStatus = finalCaptureGroupStatus(completedJobIds.length, partialJobIds.length, nextFailedJobIds.length, uncertainChunks);
      audit[index] = {
        ...current,
        status: groupComplete ? finalStatus : current.status,
        error: current.error || String(details.error || 'Processing failed'),
        settledJobIds: nextSettledJobIds,
        failedJobIds: nextFailedJobIds,
        completedChunks: completedJobIds.length,
        partialChunks: partialJobIds.length,
        failedChunks: nextFailedJobIds.length,
        uncertainChunks,
        partial: finalStatus === 'partial',
      };
      return {
        status: groupComplete ? finalStatus : 'pending',
        chunkStatus: 'failed',
        filename: jobInfo.filename,
        error: audit[index].error,
        completedChunks: completedJobIds.length,
        partialChunks: partialJobIds.length,
        failedChunks: nextFailedJobIds.length,
        expectedChunks,
        uncertainChunks,
        result: current.result || { entities: 0, relationships: 0 },
      };
    }

    const jobResult = details.result || {};
    const previousResult = current.result || {};
    const result = {
      entities: (Number(previousResult.entities) || 0) + (Number(jobResult.entities) || 0),
      relationships: (Number(previousResult.relationships) || 0) + (Number(jobResult.relationships) || 0),
    };
    const nextPartialJobIds = status === 'partial' ? [...partialJobIds, jobId] : partialJobIds;
    const nextCompletedJobIds = status === 'success' ? [...completedJobIds, jobId] : completedJobIds;
    const nextFailedJobIds = [...failedJobIds];
    const finalStatus = finalCaptureGroupStatus(nextCompletedJobIds.length, nextPartialJobIds.length, nextFailedJobIds.length, uncertainChunks);
    audit[index] = {
      ...current,
      status: groupComplete ? finalStatus : current.status,
      settledJobIds: nextSettledJobIds,
      completedJobIds: nextCompletedJobIds,
      partialJobIds: nextPartialJobIds,
      completedChunks: nextCompletedJobIds.length,
      partialChunks: nextPartialJobIds.length,
      failedChunks: nextFailedJobIds.length,
      uncertainChunks,
      error: details.error ? (current.error || String(details.error)) : current.error,
      partial: finalStatus === 'partial',
      result,
    };

    if (groupComplete) {
      if (finalStatus === 'success') signatureToCommit = jobInfo.captureSignature;
      return {
        status: finalStatus,
        filename: jobInfo.filename,
        completedChunks: nextCompletedJobIds.length,
        partialChunks: nextPartialJobIds.length,
        failedChunks: nextFailedJobIds.length,
        expectedChunks,
        uncertainChunks,
        error: audit[index].error,
        result,
      };
    }
    return {
      status: 'pending',
      completedChunks: nextCompletedJobIds.length,
      partialChunks: nextPartialJobIds.length,
      failedChunks: nextFailedJobIds.length,
      expectedChunks,
      uncertainChunks,
      error: audit[index].error,
      result,
    };
  });
  if (['success', 'replayed'].includes(outcome.status) && normalizeCaptureSignature(signatureToCommit)) {
    try {
      await commitCaptureSignature(signatureToCommit);
    } catch (error) {
      console.warn('[Omni-Context] Unable to persist completed capture signature', error);
      return { ...outcome, signaturePending: true };
    }
  }
  return outcome;
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
  if (data.automatic === true && await hasUncertainCaptureSignature(data.captureSignature)) {
    return {
      ok: false,
      status: 'uncertain',
      error: 'This capture already has an unresolved submission status; automatic re-upload is suppressed.',
    };
  }
  const privacy = await prepareCapture(data);
  if (!privacy.ok) return privacy;
  const prefix = data.source ? data.source + '-' : '';
  return submitChunksAndPoll({
    filename: sanitizeFilename(prefix + (data.title || data.url || 'webpage')) + '.txt',
    text: privacy.formatted,
    auditId: privacy.auditId,
    stats: privacy.stats,
    captureSignature: data.captureSignature,
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
    captureSignature: data.captureSignature,
  });
}

// --- Async job: submit + fast polling with alarm fallback ---

async function submitChunksAndPoll({ filename, text, auditId, stats, captureSignature }) {
  const chunks = splitCaptureText(text);
  const jobIds = [];
  const signature = normalizeCaptureSignature(captureSignature);
  if (chunks.length === 0) {
    const error = 'Capture contains no text to submit';
    await failCaptureGroup(auditId, error, { jobIds, expectedChunks: 0 });
    return { ok: false, error, jobIds, ...stats };
  }
  await updateQueuedCaptureAudit(auditId, {
    status: 'submitting',
    filename,
    captureSignature: signature,
    expectedChunks: chunks.length,
    submittedChunks: 0,
    completedChunks: 0,
    partialChunks: 0,
    failedChunks: 0,
    uncertainChunks: 0,
    jobIds,
    settledJobIds: [],
    completedJobIds: [],
    partialJobIds: [],
    failedJobIds: [],
    unconfirmedChunkIndices: [],
    unconfirmedChunks: [],
    result: { entities: 0, relationships: 0 },
  });
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
        captureSignature: signature,
      });
      jobIds.push(jobId);
    }
  } catch (error) {
    const uncertainChunkIndices = Array.from({ length: chunks.length - jobIds.length }, (_, offset) => jobIds.length + offset + 1);
    const outcome = await markCaptureSubmissionUncertain(auditId, error, {
      jobIds,
      expectedChunks: chunks.length,
      unconfirmedChunkIndices: uncertainChunkIndices,
    });
    if (outcome.status === 'uncertain') notifyCaptureOutcome(outcome, filename);
    return {
      ok: false,
      error: String(error),
      status: outcome.status,
      jobIds,
      uncertainChunks: uncertainChunkIndices.length,
      ...stats,
    };
  }
  await updateQueuedCaptureAudit(auditId, { status: 'queued', jobId: jobIds[0], jobIds, submittedChunks: jobIds.length });
  return { ok: true, jobId: jobIds[0], jobIds, ...stats };
}

async function submitChunk({ filename, base64, auditId, chunkIndex, totalChunks, captureSignature }) {
  try {
    const res = await apiFetch('/api/ingest/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, contentType: 'text/plain', base64 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);

    const jobId = data.jobId;
    if (typeof jobId !== 'string' || jobId.length === 0) throw new Error('Server returned no job ID');
    await trackPendingJob(jobId, filename, auditId, chunkIndex, totalChunks, captureSignature);
    await recordSubmittedCaptureJob(auditId, jobId, totalChunks);

    chrome.alarms.create(`${POLL_ALARM_PREFIX}${jobId}`, { periodInMinutes: FALLBACK_ALARM_PERIOD_MINUTES });
    startFastPoll(jobId);

    return jobId;
  } catch (error) {
    console.error('[Omni-Context] Ingest submit failed:', error);
    throw error;
  }
}

async function recordSubmittedCaptureJob(auditId, jobId, totalChunks) {
  return mutateCaptureAudit((audit) => {
    const index = audit.findIndex((item) => item.id === auditId);
    if (index < 0 || isTerminalCaptureStatus(audit[index].status)) return false;
    const current = audit[index];
    const jobIds = Array.isArray(current.jobIds) ? [...current.jobIds] : [];
    if (!jobIds.includes(jobId)) jobIds.push(jobId);
    audit[index] = {
      ...current,
      status: 'queued',
      expectedChunks: Number(current.expectedChunks) || totalChunks,
      submittedChunks: jobIds.length,
      jobIds,
      jobId: jobIds[0],
    };
  });
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
    const outcome = await recordCaptureChunkOutcome(jobId, jobInfo, 'failed', {
      error: 'Processing timed out before a result was received',
    });
    notifyCaptureOutcome(outcome, jobInfo.filename);
    if (outcome.signaturePending) return 'pending';
    await untrackPendingJob(jobId);
    chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
    return 'done';
  }

  try {
    const res = await apiFetch(`/api/ingest/job/${jobId}`);
    if (!res.ok) {
      if (res.status === 404) {
        const outcome = await recordCaptureChunkOutcome(jobId, jobInfo, 'failed', { error: '任务已过期' });
        notifyCaptureOutcome(outcome, jobInfo.filename);
        if (outcome.signaturePending) return 'pending';
        await untrackPendingJob(jobId);
        chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
        return 'done';
      }
      return 'pending';
    }

    const job = await res.json();

    if (job.status === 'success' || job.status === 'partial') {
      const r = job.result || {};
      const chunkStatus = job.status === 'partial' ? 'partial' : 'success';
      const outcome = await recordCaptureChunkOutcome(jobId, jobInfo, chunkStatus, {
        result: r,
        error: job.error || (chunkStatus === 'partial' ? r.summary : undefined),
      });
      notifyCaptureOutcome(outcome, outcome.filename || jobInfo.filename);
      if (outcome.signaturePending) return 'pending';
      await untrackPendingJob(jobId);
      chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
      return 'done';
    } else if (job.status === 'failed') {
      const outcome = await recordCaptureChunkOutcome(jobId, jobInfo, 'failed', {
        error: job.error || 'Processing failed',
      });
      notifyCaptureOutcome(outcome, outcome.filename || jobInfo.filename);
      if (outcome.signaturePending) return 'pending';
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

function notifyCaptureOutcome(outcome, filename) {
  const entities = Number(outcome.result?.entities) || 0;
  const relationships = Number(outcome.result?.relationships) || 0;
  if (outcome.status === 'success') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Omni-Context: 沉淀完成',
      message: `${filename}: ${outcome.completedChunks} 个分块成功；已抽取 ${entities} 实体 / ${relationships} 关系`,
    });
    return;
  }
  if (outcome.status === 'partial') {
    const counts = Number(outcome.partialChunks) > 0
      ? `${outcome.completedChunks} 个分块成功 / ${outcome.partialChunks} 个部分完成 / ${outcome.failedChunks} 个失败`
      : `${outcome.completedChunks} 个分块成功 / ${outcome.failedChunks} 个失败`;
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Omni-Context: 部分完成',
      message: `${filename}: ${counts}；已抽取 ${entities} 实体 / ${relationships} 关系${outcome.error ? `；${outcome.error}` : ''}`,
    });
    return;
  }
  if (outcome.status === 'uncertain') {
    const acceptedCounts = `${outcome.completedChunks} 个成功 / ${outcome.partialChunks || 0} 个部分完成 / ${outcome.failedChunks} 个失败`;
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Omni-Context: 部分完成（状态待核对）',
      message: `${filename}: 已确认 ${acceptedCounts}，另有 ${outcome.uncertainChunks} 个分块状态未确认；已抽取 ${entities} 实体 / ${relationships} 关系。${outcome.error ? `原因：${outcome.error}。` : ''}未自动重传，请核对后再操作。`,
    });
    return;
  }
  if (outcome.status === 'failed') {
    notifyJobError(
      filename,
      `${outcome.failedChunks} 个分块失败 / ${outcome.completedChunks} 个成功：${outcome.error || 'Processing failed'}`,
    );
  }
}

// --- Pending job persistence (chrome.storage.local) ---

async function getPendingJobs() {
  const result = await chrome.storage.local.get(PENDING_JOBS_KEY);
  return result[PENDING_JOBS_KEY] || {};
}

async function trackPendingJob(jobId, filename, auditId, chunkIndex = 1, totalChunks = 1, captureSignature = null) {
  return mutatePendingJobs((jobs) => {
    jobs[jobId] = {
      filename,
      auditId,
      chunkIndex,
      totalChunks,
      startedAt: Date.now(),
      ...(normalizeCaptureSignature(captureSignature) ? { captureSignature: normalizeCaptureSignature(captureSignature) } : {}),
    };
  });
}

async function untrackPendingJob(jobId) {
  return mutatePendingJobs((jobs) => { delete jobs[jobId]; });
}

function mutatePendingJobs(mutate) {
  const task = pendingJobsMutationQueue.then(async () => {
    const result = await chrome.storage.local.get(PENDING_JOBS_KEY);
    const jobs = result[PENDING_JOBS_KEY] && typeof result[PENDING_JOBS_KEY] === 'object'
      ? { ...result[PENDING_JOBS_KEY] }
      : {};
    await mutate(jobs);
    await chrome.storage.local.set({ [PENDING_JOBS_KEY]: jobs });
    return jobs;
  });
  pendingJobsMutationQueue = task.catch(() => {});
  return task;
}
