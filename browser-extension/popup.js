// Omni-Context Popup Script
const API_BASE = 'http://127.0.0.1:3001';

let localToken = '';

async function getToken() {
  const result = await chrome.storage.local.get('localApiToken');
  return result.localApiToken || '';
}

async function apiFetch(path, options = {}) {
  if (!localToken) {
    localToken = await getToken();
  }
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (localToken) {
    headers['Authorization'] = `Bearer ${localToken}`;
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('capturePageBtn')?.addEventListener('click', capturePage);
  document.getElementById('captureSelectionBtn')?.addEventListener('click', captureSelection);
  document.getElementById('saveTokenBtn')?.addEventListener('click', saveToken);
  document.getElementById('askBtn')?.addEventListener('click', askBrain);
  document.getElementById('askInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') askBrain(); });

  await initPrivacyControls();

  localToken = await getToken();

  if (localToken) {
    document.getElementById('tokenSetup').classList.add('hidden');
    checkConnection();
    loadStats();
  } else {
    document.getElementById('tokenSetup').classList.remove('hidden');
    document.getElementById('statusDot').className = 'w-2 h-2 rounded-full bg-amber-400';
    document.getElementById('statusText').textContent = '需要使用短期配对码连接';
  }
});

async function saveToken() {
  const input = document.getElementById('tokenInput');
  const pairCode = input.value.trim();
  if (!/^\d{6}$/.test(pairCode)) {
    showNotification('请输入桌面端显示的 6 位短期配对码');
    return;
  }

  const stored = await chrome.storage.local.get('browserDeviceId');
  const deviceId = stored.browserDeviceId || `browser-${crypto.randomUUID()}`;
  await chrome.storage.local.set({ browserDeviceId: deviceId });
  try {
    const response = await fetch(`${API_BASE}/api/auth/pair/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pairCode}`,
      },
      body: JSON.stringify({
        device_id: deviceId,
        device_type: 'browser_extension',
        requested_scopes: ['memory:read', 'memory:write', 'decision:read'],
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.device_token) throw new Error(data.error || `HTTP ${response.status}`);
    await chrome.storage.local.set({ localApiToken: data.device_token });
    localToken = data.device_token;
    input.value = '';
    document.getElementById('tokenSetup').classList.add('hidden');
    document.getElementById('statusText').textContent = '设备 Token 已签发，检查连接...';
    checkConnection();
    loadStats();
  } catch (error) {
    showNotification(`配对失败：${error.message || String(error)}`);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function initPrivacyControls() {
  const toggle = document.getElementById('autoCaptureToggle');
  const pauseToggle = document.getElementById('pauseCaptureToggle');
  const allowButton = document.getElementById('allowDomainBtn');
  const blockButton = document.getElementById('blockDomainBtn');
  const tab = await getActiveTab();
  const domain = OmniPrivacy.normalizeDomain(tab?.url || '');
  const r = await chrome.storage.local.get('settings');
  const settings = OmniPrivacy.mergeSettings(r.settings);
  if (toggle) toggle.checked = settings.autoCapture;
  if (pauseToggle) pauseToggle.checked = settings.capturePaused;
  const domainLabel = document.getElementById('currentDomain');
  if (domainLabel) domainLabel.textContent = domain || '不可访问页面';

  const persist = async (next) => {
    await chrome.storage.local.set({ settings: OmniPrivacy.mergeSettings(next) });
  };

  toggle.addEventListener('change', async () => {
    const current = OmniPrivacy.mergeSettings((await chrome.storage.local.get('settings')).settings);
    if (toggle.checked) {
      const confirmed = confirm(
        `启用自动沉淀将允许 Omni-Context 在 ${domain || '当前 AI 站点'} 回答结束后读取对话。\n\n`
        + '内容会发送到本机 Brain Server；如果你配置了远程 LLM，内容可能离开本机。继续吗？',
      );
      if (!confirmed || !domain) {
        toggle.checked = false;
        return;
      }
      current.allowedDomains = [...current.allowedDomains, domain];
    }
    current.autoCapture = toggle.checked;
    await persist(current);
  });

  pauseToggle?.addEventListener('change', async () => {
    const current = OmniPrivacy.mergeSettings((await chrome.storage.local.get('settings')).settings);
    current.capturePaused = pauseToggle.checked;
    await persist(current);
  });

  allowButton?.addEventListener('click', async () => {
    if (!domain) return;
    const current = OmniPrivacy.mergeSettings((await chrome.storage.local.get('settings')).settings);
    current.blockedDomains = current.blockedDomains.filter((item) => item !== domain);
    current.allowedDomains = [...current.allowedDomains, domain];
    await persist(current);
    showNotification(`已允许 ${domain}`);
  });

  blockButton?.addEventListener('click', async () => {
    if (!domain) return;
    const current = OmniPrivacy.mergeSettings((await chrome.storage.local.get('settings')).settings);
    current.allowedDomains = current.allowedDomains.filter((item) => item !== domain);
    current.blockedDomains = [...current.blockedDomains, domain];
    await persist(current);
    showNotification(`已阻止 ${domain}`);
  });

  const state = await chrome.runtime.sendMessage({ type: 'GET_PRIVACY_STATE', url: tab?.url || '' });
  if (state?.lastCapture) {
    const last = state.lastCapture;
    document.getElementById('lastCapture').textContent =
      `${last.status} · ${last.sentCharacters || 0} 字符 · ${last.payloadChunks || 0} 块 · 遮盖 ${last.redactedCount || 0}`;
  }
}

async function askBrain() {
  const input = document.getElementById('askInput');
  const q = input.value.trim();
  if (!q) return;
  const ans = document.getElementById('askAnswer');
  ans.classList.remove('hidden');
  if (!(await ensureToken())) { ans.textContent = '请先用桌面端显示的短期配对码连接'; return; }
  ans.textContent = '想一下…';
  try {
    const res = await apiFetch('/api/mcp/tool/ask_memory', {
      method: 'POST',
      body: JSON.stringify({ arguments: { query: q } }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json().catch(() => ({}));
    ans.textContent = d.reply || '（我的记忆里暂时没有相关内容）';
  } catch (e) {
    ans.textContent = '连不上大脑（确认桌面端在运行、token 已配）';
  }
}

async function checkConnection() {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  try {
    const response = await apiFetch('/health');
    if (response.ok) {
      statusDot.className = 'w-2 h-2 rounded-full bg-green-400';
      statusText.textContent = '已连接到大脑';
    } else {
      throw new Error('Not connected');
    }
  } catch (error) {
    statusDot.className = 'w-2 h-2 rounded-full bg-red-400';
    statusText.textContent = '大脑离线';
  }
}

async function loadStats() {
  try {
    const response = await apiFetch('/api/stats');
    if (response.ok) {
      const stats = await response.json();
      document.getElementById('todayCount').textContent = stats.database?.entities || 0;
      document.getElementById('totalCount').textContent = stats.database?.relationships || 0;
    }
  } catch (error) {
    console.warn('Could not load stats');
  }
}

// 点按钮时当场在页面里执行，不依赖预先注入的 content.js（重载扩展后旧标签页也能读）
async function runInPage(func) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('no-tab');
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func });
  return { tab, result: res?.result };
}

async function capturePage() {
  if (!(await ensureToken())) return;
  let page, tab;
  try {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t?.id) throw new Error('no-tab');
    tab = t;
    // 先确保对话提取器在页面里（重载扩展后旧标签页也能用）
    try { await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['extractor.js'] }); } catch {}
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: t.id },
      func: () => {
        const conv = globalThis.__omniExtractConversation && globalThis.__omniExtractConversation();
        if (conv) return conv;
        return { url: location.href, title: document.title, content: (document.body?.innerText || '').slice(0, 10000) };
      },
    });
    page = res?.result;
  } catch {
    showNotification('这个页面读不了（如 chrome:// 或 PDF），换个普通网页');
    return;
  }
  if (!page?.content) { showNotification('页面没有可读文本'); return; }

  const confirmed = await confirmCapturePreview({
    url: page.url || tab.url,
    content: page.content,
    source: page.source,
  });
  if (!confirmed) return;

  showNotification(page.source ? `正在沉淀 ${page.source} 对话（${page.turns} 轮）…` : '正在沉淀…');
  const result = await sendCapture({ url: page.url || tab.url, title: page.title || tab.title, content: page.content, source: page.source, preformatted: !!page.source, previewConfirmed: true });
  showNotification(result?.ok ? `✓ 已发送 ${result.sentCharacters} 字符 / ${result.payloadChunks} 块，后台抽取中` : `✗ ${result?.error || '提交失败'}`);
  loadStats();
}

async function captureSelection() {
  if (!(await ensureToken())) return;
  let sel, tab;
  try {
    const r = await runInPage(() => {
      let s = window.getSelection()?.toString() || '';
      const a = document.activeElement;
      if (!s && a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) {
        try { s = a.value.slice(a.selectionStart, a.selectionEnd); } catch {}
      }
      return { url: location.href, title: document.title, text: s };
    });
    sel = r.result; tab = r.tab;
  } catch {
    showNotification('这个页面读不了（如 chrome:// 或 PDF），换个普通网页');
    return;
  }
  if (!sel?.text?.trim()) { showNotification('没有检测到选中文本（先在页面里选一段再点）'); return; }

  const confirmed = await confirmCapturePreview({ url: sel.url || tab.url, content: sel.text, source: 'selection' });
  if (!confirmed) return;

  showNotification('正在沉淀…');
  const result = await sendCapture({ url: sel.url || tab.url, title: sel.title || tab.title, content: sel.text, selection: true, previewConfirmed: true });
  showNotification(result?.ok ? `✓ 已发送 ${result.sentCharacters} 字符 / ${result.payloadChunks} 块` : `✗ ${result?.error || '提交失败'}`);
  loadStats();
}

async function sendCapture(data) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: data.selection ? 'CAPTURE_SELECTION' : 'CAPTURE_PAGE',
      data,
    });
    return response;
  } catch {
    return { ok: false, error: '无法连接扩展后台' };
  }
}

async function confirmCapturePreview(data) {
  const settings = OmniPrivacy.mergeSettings((await chrome.storage.local.get('settings')).settings);
  const policy = OmniPrivacy.evaluateCapturePolicy(settings, data.url || '', { automatic: false });
  if (!policy.allowed) {
    showNotification(`此站点已阻止捕获：${policy.reason}`);
    return false;
  }
  const redacted = settings.redactSensitiveFields
    ? OmniPrivacy.redactSensitiveText(data.content || '')
    : { text: data.content || '', redactedCount: 0 };
  const stats = OmniPrivacy.captureStats(redacted.text, redacted.redactedCount);
  const preview = redacted.text.slice(0, 700);
  return confirm(
    `即将发送 ${stats.sentCharacters} 个字符（${stats.payloadChunks} 块），已遮盖 ${stats.redactedCount} 处敏感字段。\n`
    + '内容发送到本机 Brain Server；若已配置远程 LLM，内容可能离开本机。\n\n'
    + `预览：\n${preview}${redacted.text.length > preview.length ? '\n…' : ''}`,
  );
}

async function ensureToken() {
  if (!localToken) localToken = await getToken();
  if (!localToken) {
    document.getElementById('tokenSetup')?.classList.remove('hidden');
    showNotification('请先使用桌面端显示的 6 位短期配对码连接');
    return false;
  }
  return true;
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0,200,255,0.9);
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 13px;
    animation: fadeIn 0.2s;
    white-space: nowrap;
  `;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 2000);
}
