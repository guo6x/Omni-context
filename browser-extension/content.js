// Omni-Context Content Script
(function() {
  // 仅顶层 frame 注入悬浮按钮，避免 iframe / sandbox 中重复出现
  if (window.top !== window.self) return;
  // 跳过非 HTML 文档（PDF、纯图片预览等）
  if (document.contentType && document.contentType !== 'text/html' && document.contentType !== 'application/xhtml+xml') return;
  if (document.getElementById('omni-floating-container')) return;

  const floatingButton = document.createElement('div');
  floatingButton.id = 'omni-floating-container';
  floatingButton.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
  `;

  const button = document.createElement('button');
  button.id = 'omni-capture-btn';
  button.title = 'Capture to Omni-Context';
  button.type = 'button';
  button.setAttribute('aria-label', 'Capture page to Omni-Context');
  button.style.cssText = `
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: linear-gradient(135deg, #00c8ff, #6400ff);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    box-shadow: 0 4px 20px rgba(0, 200, 255, 0.4);
    transition: transform 0.2s, box-shadow 0.2s;
  `;

  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('width', '24');
  icon.setAttribute('height', '24');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '2');
  icon.setAttribute('aria-hidden', 'true');

  [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['circle', { cx: '12', cy: '12', r: '3' }],
    ['path', { d: 'M12 2v4M12 18v4M2 12h4M18 12h4' }],
  ].forEach(([tag, attributes]) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    icon.appendChild(element);
  });

  button.appendChild(icon);
  floatingButton.appendChild(button);

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.1)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1)';
  });

  let busy = false;
  button.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    button.style.opacity = '0.55';
    const payload = getPagePayload();
    showToast(payload.source ? `正在沉淀 ${payload.source} 对话（${payload.turns} 轮）…` : '正在沉淀当前页面…');
    chrome.runtime.sendMessage({ type: 'CAPTURE_PAGE', data: payload }, (resp) => {
      busy = false;
      button.style.opacity = '1';
      if (chrome.runtime.lastError) { showToast('✗ 连不上大脑（确认桌面端在运行、token 已配）'); return; }
      if (resp && resp.ok) {
        // 手动捕获后记下签名，避免自动观察器紧接着重复沉淀同一段对话
        if (payload.source) { try { setAutoSig(urlKey(), { sig: globalThis.__omniConversationSignature(payload), count: payload.turns }); } catch (e) {} }
        showToast(payload.source ? `✓ 已捕获 ${payload.turns} 轮对话，后台抽取中` : '✓ 已捕获，正在后台抽取');
      } else {
        showToast('✗ ' + ((resp && resp.error) || '提交失败'));
      }
    });
  });

  document.body.appendChild(floatingButton);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_PAGE_CONTENT') {
      sendResponse(getPagePayload());
      return true;
    }

    if (message.type === 'GET_SELECTION') {
      sendResponse({
        url: window.location.href,
        title: document.title,
        text: window.getSelection()?.toString() || '',
      });
      return true;
    }
  });

  function getPagePayload() {
    // 优先按对话提取（ChatGPT / Claude / Gemini），拿不到再回退整页 innerText
    const conv = globalThis.__omniExtractConversation && globalThis.__omniExtractConversation();
    if (conv) {
      return { url: conv.url, title: conv.title, content: conv.content, source: conv.source, turns: conv.turns, preformatted: true };
    }
    return {
      url: window.location.href,
      title: document.title,
      content: document.body.innerText.substring(0, 10000),
    };
  }

  // 页面内即时提示（chrome 通知常被系统吞，这个一定看得到）
  let toastTimer = null;
  function showToast(text) {
    let toast = document.getElementById('omni-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'omni-toast';
      toast.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:1000000;background:rgba(10,11,18,0.96);color:#e8e8e8;padding:9px 14px;border-radius:9px;font-size:13px;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,0.45);border:1px solid rgba(34,211,238,0.35);max-width:280px;transition:opacity 0.25s;';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 3200);
  }

  // ---- 自动沉淀 AI 对话（settings.autoCapture 开启时）----
  // 仅在已识别的 AI 站点挂观察器，避免在普通网页空转。
  let autoEnabled = false;
  let autoObserver = null;
  let autoTimer = null;
  let autoInFlight = false;

  function urlKey() { return location.origin + location.pathname; }

  async function getAutoSig(key) {
    try { const r = await chrome.storage.local.get('autoSig'); return (r.autoSig || {})[key] || null; }
    catch { return null; }
  }
  async function setAutoSig(key, entry) {
    try {
      const r = await chrome.storage.local.get('autoSig');
      const map = r.autoSig || {};
      map[key] = entry;
      const keys = Object.keys(map);
      if (keys.length > 200) delete map[keys[0]]; // 控制体积
      await chrome.storage.local.set({ autoSig: map });
    } catch {}
  }

  async function tryAutoCapture() {
    if (!autoEnabled || autoInFlight) return;
    const conv = globalThis.__omniExtractConversation && globalThis.__omniExtractConversation();
    if (!conv || conv.lastRole !== 'assistant') return; // 等这轮回答结束再沉淀
    const sig = globalThis.__omniConversationSignature(conv);
    const key = urlKey();
    const prev = await getAutoSig(key);
    if (prev && (prev.sig === sig || conv.turns <= prev.count)) return; // 没新内容/被虚拟列表截短
    autoInFlight = true;
    showToast(`自动沉淀 ${conv.source} 对话（${conv.turns} 轮）…`);
    chrome.runtime.sendMessage({
      type: 'CAPTURE_PAGE',
      data: { url: conv.url, title: conv.title, content: conv.content, source: conv.source, turns: conv.turns, preformatted: true },
    }, (resp) => {
      autoInFlight = false;
      if (chrome.runtime.lastError) return;
      if (resp && resp.ok) { setAutoSig(key, { sig, count: conv.turns }); showToast(`✓ 已自动沉淀 ${conv.turns} 轮对话`); }
    });
  }

  function scheduleAuto() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(tryAutoCapture, 3500); // 对话稳定 3.5s 后再抓（等流式输出结束）
  }
  function startAuto() {
    if (autoObserver) return;
    autoObserver = new MutationObserver(scheduleAuto);
    autoObserver.observe(document.body, { childList: true, subtree: true });
    scheduleAuto(); // 处理「打开时对话已存在」
  }
  function stopAuto() {
    if (autoObserver) { autoObserver.disconnect(); autoObserver = null; }
    clearTimeout(autoTimer);
  }

  if (/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$|(^|\.)claude\.ai$|(^|\.)gemini\.google\.com$/i.test(location.hostname)) {
    chrome.storage.local.get('settings').then((r) => {
      autoEnabled = !!(r.settings && r.settings.autoCapture);
      if (autoEnabled) startAuto();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      autoEnabled = !!(changes.settings.newValue && changes.settings.newValue.autoCapture);
      if (autoEnabled) startAuto(); else stopAuto();
    });
  }
})();
