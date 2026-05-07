// Omni-Context Background Service Worker
const API_BASE = 'http://localhost:3001';

let desktopConnection = null;

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

chrome.alarms?.create('omni-context-health', { periodInMinutes: 0.5 });
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'omni-context-health') {
    connectToDesktop();
  }
});

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

async function capturePage(data) {
  return sendToBrainServer({
    type: 'webpage',
    url: data.url,
    title: data.title,
    content: data.content,
  });
}

async function captureSelection(data, tab) {
  return sendToBrainServer({
    type: 'selection',
    url: data.url || tab?.url,
    title: data.title || tab?.title,
    content: data.content || data.text,
  });
}

async function sendToBrainServer(data) {
  try {
    const response = await fetch(`${API_BASE}/api/graph/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: formatCaptureText(data),
        source: 'browser-extension',
      }),
    });

    if (response.ok) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Omni-Context',
        message: data.type === 'selection' ? 'Selection captured!' : 'Page captured successfully!',
      });
      return { ok: true };
    }

    return { ok: false, error: `Brain Server returned ${response.status}` };
  } catch (error) {
    console.error('Failed to capture content:', error);
    return { ok: false, error: String(error) };
  }
}

function formatCaptureText(data) {
  return [
    `Type: ${data.type}`,
    `URL: ${data.url || ''}`,
    `Title: ${data.title || ''}`,
    '',
    data.content || '',
  ].join('\n').slice(0, 12000);
}

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
