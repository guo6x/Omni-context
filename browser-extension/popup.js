// Omni-Context Popup Script
const API_BASE = 'http://localhost:3001';

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('capturePageBtn')?.addEventListener('click', capturePage);
  document.getElementById('captureSelectionBtn')?.addEventListener('click', captureSelection);
  document.getElementById('openDesktopBtn')?.addEventListener('click', openDesktop);

  checkConnection();
  loadStats();
});

async function checkConnection() {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  try {
    const response = await fetch(`${API_BASE}/health`);
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
    const response = await fetch(`${API_BASE}/api/stats`);
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

    showNotification(result ? '网页已沉淀入大脑！' : '捕获网页失败');
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

    showNotification(result ? '选中内容已沉淀！' : '捕获失败');
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
