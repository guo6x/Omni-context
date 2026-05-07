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

  button.addEventListener('click', () => {
    chrome.runtime.sendMessage({
      type: 'CAPTURE_PAGE',
      data: getPagePayload(),
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
    return {
      url: window.location.href,
      title: document.title,
      content: document.body.innerText.substring(0, 10000),
    };
  }
})();
