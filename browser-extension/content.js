// Omni-Context Content Script
(function() {
  console.log('Omni-Context content script loaded');
  
  const floatingButton = document.createElement('div');
  floatingButton.innerHTML = `
    <button id="omni-capture-btn" title="Capture to Omni-Context">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="3"/>
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
      </svg>
    </button>
  `;
  floatingButton.id = 'omni-floating-container';
  floatingButton.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 999999;
  `;
  
  const btnStyle = floatingButton.querySelector('button').style;
  btnStyle.cssText = `
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
  
  floatingButton.querySelector('button').addEventListener('mouseenter', () => {
    floatingButton.querySelector('button').style.transform = 'scale(1.1)';
  });
  
  floatingButton.querySelector('button').addEventListener('mouseleave', () => {
    floatingButton.querySelector('button').style.transform = 'scale(1)';
  });
  
  floatingButton.querySelector('button').addEventListener('click', captureCurrentPage);
  
  document.body.appendChild(floatingButton);
  
  function captureCurrentPage() {
    const content = document.body.innerText.substring(0, 10000);
    
    chrome.runtime.sendMessage({
      type: 'CAPTURE_PAGE',
      data: {
        url: window.location.href,
        title: document.title,
        content: content
      }
    });
  }
  
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_PAGE_CONTENT') {
      chrome.runtime.sendMessage({
        type: 'CAPTURE_PAGE',
        data: {
          url: window.location.href,
          title: document.title,
          content: document.body.innerText.substring(0, 10000)
        }
      });
    } else if (message.type === 'GET_SELECTION') {
      const selection = window.getSelection()?.toString() || '';
      chrome.runtime.sendMessage({
        type: 'CAPTURE_SELECTION',
        data: {
          text: selection,
          selection: selection
        }
      });
    }
  });
})();
