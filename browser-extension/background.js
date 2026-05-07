// Omni-Context Background Service Worker
const API_BASE = 'http://localhost:3001';

let desktopConnection = null;

async function connectToDesktop() {
  try {
    const response = await fetch(`${API_BASE}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.ok) {
      desktopConnection = { status: 'connected', lastCheck: Date.now() };
      console.log('Connected to Omni-Context Desktop');
    }
  } catch (error) {
    desktopConnection = { status: 'disconnected', lastCheck: Date.now() };
    console.log('Desktop app not running');
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Omni-Context Extension installed');
  chrome.storage.local.set({ 
    settings: {
      language: 'en',
      autoCapture: true,
      syncEnabled: true
    }
  });
  connectToDesktop();
  setInterval(connectToDesktop, 30000);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_PAGE') {
    capturePage(message.data);
  } else if (message.type === 'GET_STATUS') {
    sendResponse(desktopConnection);
  } else if (message.type === 'CAPTURE_SELECTION') {
    captureSelection(message.data, sender.tab);
  }
  return true;
});

async function capturePage(data) {
  try {
    const response = await fetch(`${API_BASE}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'webpage',
        url: data.url,
        title: data.title,
        content: data.content,
        timestamp: Date.now()
      })
    });
    
    if (response.ok) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Omni-Context',
        message: 'Page captured successfully!'
      });
    }
  } catch (error) {
    console.error('Failed to capture page:', error);
  }
}

async function captureSelection(data, tab) {
  try {
    const response = await fetch(`${API_BASE}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'selection',
        url: tab.url,
        title: tab.title,
        content: data.text,
        selection: data.selection,
        timestamp: Date.now()
      })
    });
    
    if (response.ok) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Omni-Context',
        message: 'Selection captured!'
      });
    }
  } catch (error) {
    console.error('Failed to capture selection:', error);
  }
}

chrome.contextMenus?.create({
  id: 'capturePage',
  title: 'Capture this page',
  contexts: ['page']
});

chrome.contextMenus?.create({
  id: 'captureSelection',
  title: 'Capture selected text',
  contexts: ['selection']
});

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'capturePage') {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' });
  } else if (info.menuItemId === 'captureSelection') {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' });
  }
});
