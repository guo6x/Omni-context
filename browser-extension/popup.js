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

  await initAutoCaptureToggle();

  localToken = await getToken();

  if (localToken) {
    document.getElementById('tokenSetup').classList.add('hidden');
    checkConnection();
    loadStats();
  } else {
    document.getElementById('tokenSetup').classList.remove('hidden');
    document.getElementById('statusDot').className = 'w-2 h-2 rounded-full bg-amber-400';
    document.getElementById('statusText').textContent = '需要设置本地 API Token';
  }
});

async function saveToken() {
  const input = document.getElementById('tokenInput');
  const token = input.value.trim();
  if (!token) return;

  await chrome.storage.local.set({ localApiToken: token });
  localToken = token;
  document.getElementById('tokenSetup').classList.add('hidden');
  document.getElementById('statusText').textContent = 'Token 已保存，检查连接...';
  checkConnection();
  loadStats();
}

async function initAutoCaptureToggle() {
  const toggle = document.getElementById('autoCaptureToggle');
  if (!toggle) return;
  const r = await chrome.storage.local.get('settings');
  toggle.checked = !!(r.settings && r.settings.autoCapture);
  toggle.addEventListener('change', async () => {
    const cur = (await chrome.storage.local.get('settings')).settings || {};
    cur.autoCapture = toggle.checked;
    await chrome.storage.local.set({ settings: cur });
  });
}

async function askBrain() {
  const input = document.getElementById('askInput');
  const q = input.value.trim();
  if (!q) return;
  const ans = document.getElementById('askAnswer');
  ans.classList.remove('hidden');
  if (!(await ensureToken())) { ans.textContent = '请先填好本地 API Token（桌面端 设置→数据）'; return; }
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

  showNotification(page.source ? `正在沉淀 ${page.source} 对话（${page.turns} 轮）…` : '正在沉淀…');
  const result = await sendCapture({ url: page.url || tab.url, title: page.title || tab.title, content: page.content, source: page.source, preformatted: !!page.source });
  showNotification(result ? (page.source ? `✓ 已提交 ${page.turns} 轮对话，后台抽取中` : '✓ 已提交，后台抽取中') : '✗ 提交失败，确认桌面端在运行');
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

  showNotification('正在沉淀…');
  const result = await sendCapture({ url: sel.url || tab.url, title: sel.title || tab.title, content: sel.text, selection: true });
  showNotification(result ? '✓ 已提交，后台抽取中' : '✗ 提交失败，确认桌面端在运行');
  loadStats();
}

async function sendCapture(data) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: data.selection ? 'CAPTURE_SELECTION' : 'CAPTURE_PAGE',
      data,
    });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function ensureToken() {
  if (!localToken) localToken = await getToken();
  if (!localToken) {
    document.getElementById('tokenSetup')?.classList.remove('hidden');
    showNotification('请先填好本地 API Token（桌面端 设置→数据）');
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
