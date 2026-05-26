// Omni-Context Background Service Worker
const API_BASE = 'http://localhost:3001';
const JOB_TIMEOUT_MS = 30000;
const POLL_ALARM_PREFIX = 'poll-';
const PENDING_JOBS_KEY = 'pendingJobs';

let desktopConnection = null;

// --- Desktop health ---

async function connectToDesktop() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    desktopConnection = {
      status: response.ok ? 'connected' : 'disconnected',
      lastCheck: Date.now(),
    };
  } catch (error) {
    desktopConnection = { status: 'disconnected', lastCheck: Date.now() };
  }
}

// --- Init ---

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    settings: {
      language: 'en',
      autoCapture: true,
      syncEnabled: true,
    },
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
      chrome.alarms.create(`${POLL_ALARM_PREFIX}${jobId}`, { periodInMinutes: 1 / 60 });
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
});

// --- Context menus ---

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === 'capturePage') {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' }, (page) => {
      if (chrome.runtime.lastError || !page?.content) return;
      capturePage(page);
    });
  }

  if (info.menuItemId === 'captureSelection') {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' }, (selection) => {
      if (chrome.runtime.lastError || !selection?.text) return;
      captureSelection(selection, tab);
    });
  }
});

// --- Capture helpers ---

function formatCaptureText(data) {
  return [
    `Type: ${data.type}`,
    `URL: ${data.url || ''}`,
    `Title: ${data.title || ''}`,
    '',
    data.content || '',
  ].join('\n').slice(0, 12000);
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

// --- Capture entry points ---

async function capturePage(data) {
  return submitAndPoll({
    filename: sanitizeFilename(data.title || data.url || 'webpage') + '.txt',
    contentType: 'text/plain',
    base64: textToBase64(formatCaptureText(data)),
  });
}

async function captureSelection(data, tab) {
  return submitAndPoll({
    filename: sanitizeFilename(data.title || tab?.title || 'selection') + '.txt',
    contentType: 'text/plain',
    base64: textToBase64(formatCaptureText({
      type: 'selection',
      url: data.url || tab?.url,
      title: data.title || tab?.title,
      content: data.content || data.text,
    })),
  });
}

// --- Async job: submit + alarm-based polling ---

async function submitAndPoll({ filename, contentType, base64 }) {
  try {
    const res = await fetch(`${API_BASE}/api/ingest/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, contentType, base64 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);

    const jobId = data.jobId;
    await trackPendingJob(jobId, filename);

    chrome.alarms.create(`${POLL_ALARM_PREFIX}${jobId}`, { periodInMinutes: 1 / 60 });

    return { ok: true };
  } catch (error) {
    console.error('[Omni-Context] Ingest submit failed:', error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Omni-Context: 提交失败',
      message: error.message || String(error),
    });
    return { ok: false, error: String(error) };
  }
}

async function handlePoll(jobId) {
  const jobs = await getPendingJobs();
  const jobInfo = jobs[jobId];
  if (!jobInfo) {
    chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
    return;
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
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/ingest/job/${jobId}`);
    if (!res.ok) {
      if (res.status === 404) {
        notifyJobError(jobInfo.filename, '任务已过期');
        await untrackPendingJob(jobId);
        chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
      }
      return;
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
      await untrackPendingJob(jobId);
      chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
    } else if (job.status === 'failed') {
      notifyJobError(jobInfo.filename, job.error || '处理失败');
      await untrackPendingJob(jobId);
      chrome.alarms.clear(`${POLL_ALARM_PREFIX}${jobId}`);
    }
    // running / queued: keep polling
  } catch {
    // Network error — retry on next alarm tick
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

async function trackPendingJob(jobId, filename) {
  const jobs = await getPendingJobs();
  jobs[jobId] = { filename, startedAt: Date.now() };
  await chrome.storage.local.set({ [PENDING_JOBS_KEY]: jobs });
}

async function untrackPendingJob(jobId) {
  const jobs = await getPendingJobs();
  delete jobs[jobId];
  await chrome.storage.local.set({ [PENDING_JOBS_KEY]: jobs });
}
