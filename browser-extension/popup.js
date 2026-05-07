// Omni-Context Popup Script
const API_BASE = 'http://localhost:3001';

document.addEventListener('DOMContentLoaded', async () => {
  checkConnection();
  loadStats();
});

async function checkConnection() {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (response.ok) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Connected to Desktop';
    } else {
      throw new Error('Not connected');
    }
  } catch (error) {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'Desktop app not running';
  }
}

async function loadStats() {
  try {
    const response = await fetch(`${API_BASE}/api/stats`);
    if (response.ok) {
      const stats = await response.json();
      document.getElementById('todayCount').textContent = stats.today || 0;
      document.getElementById('totalCount').textContent = stats.total || 0;
    }
  } catch (error) {
    console.log('Could not load stats');
  }
}

async function capturePage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  try {
    const response = await fetch(`${API_BASE}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'webpage',
        url: tab.url,
        title: tab.title,
        timestamp: Date.now()
      })
    });
    
    if (response.ok) {
      showNotification('Page captured!');
    }
  } catch (error) {
    showNotification('Failed to capture page');
  }
}

async function captureSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' }, (response) => {
    if (response && response.text) {
      fetch(`${API_BASE}/api/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'selection',
          url: tab.url,
          title: tab.title,
          content: response.text,
          timestamp: Date.now()
        })
      }).then(() => showNotification('Selection captured!'))
        .catch(() => showNotification('Failed to capture'));
    }
  });
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
  `;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 2000);
}
