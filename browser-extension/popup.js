// Omni-Context Popup Script
const API_BASE = 'http://localhost:3001';

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
  document.getElementById('openDesktopBtn')?.addEventListener('click', openDesktop);
  document.getElementById('saveTokenBtn')?.addEventListener('click', saveToken);

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

async function capturePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' }, async (page) => {
    if (chrome.runtime.lastError || !page?.content) {
      showNotification('无法读取当前页面内容');
      return;
    }

    const result = await sendCapture({
      url: page.url || tab.url,
      title: page.title || tab.title,
      content: page.content,
    });

    showNotification(result ? '已提交' : '提交失败');
    loadStats();
  });
}

async function captureSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' }, async (response) => {
    if (chrome.runtime.lastError || !response?.text) {
      showNotification('没有检测到选中文本');
      return;
    }

    const result = await sendCapture({
      url: response.url || tab.url,
      title: response.title || tab.title,
      content: response.text,
      selection: true,
    });

    showNotification(result ? '已提交' : '提交失败');
    loadStats();
  });
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

function openDesktop() {
  chrome.tabs.create({ url: 'omni-context://open' });
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
