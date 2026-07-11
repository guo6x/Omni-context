// Omni-Context 对话提取器
// 识别 ChatGPT / Claude / Gemini 的对话 DOM，按角色拆成干净的 Q&A，
// 而不是把整页 innerText 一把抓。content.js 与 popup（chrome.scripting）共用。
// 设计为「自包含、幂等」：可被注入多次而不报错，不依赖任何外部作用域。
(function () {
  if (globalThis.__omniExtractConversation) return; // 幂等：已注入则跳过

  const AI_SITES = [
    { test: (h) => /(^|\.)chatgpt\.com$/i.test(h) || /(^|\.)chat\.openai\.com$/i.test(h), name: 'ChatGPT', extract: extractChatGPT },
    { test: (h) => /(^|\.)claude\.ai$/i.test(h), name: 'Claude', extract: extractClaude },
    { test: (h) => /(^|\.)gemini\.google\.com$/i.test(h), name: 'Gemini', extract: extractGemini },
  ];

  function detectSite() {
    const h = location.hostname;
    return AI_SITES.find((s) => s.test(h)) || null;
  }

  function cleanText(s) {
    return (s || '')
      .replace(/ /g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function pushTurn(turns, role, text) {
    const t = cleanText(text);
    if (t) turns.push({ role, text: t.slice(0, 12000) });
  }

  // ChatGPT：每条消息是 [data-message-author-role="user|assistant"]
  function extractChatGPT() {
    const turns = [];
    document.querySelectorAll('[data-message-author-role]').forEach((el) => {
      const role = el.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant';
      const body = el.querySelector('.markdown') || el.querySelector('.whitespace-pre-wrap') || el;
      pushTurn(turns, role, body.innerText || body.textContent);
    });
    return turns;
  }

  // Claude：用户消息 [data-testid="user-message"]，助手消息 .font-claude-message
  function extractClaude() {
    const turns = [];
    document.querySelectorAll('[data-testid="user-message"], .font-claude-message').forEach((el) => {
      const isUser = el.matches('[data-testid="user-message"]');
      pushTurn(turns, isUser ? 'user' : 'assistant', el.innerText || el.textContent);
    });
    return turns;
  }

  // Gemini：自定义元素 <user-query> / <model-response>
  function extractGemini() {
    const turns = [];
    document.querySelectorAll('user-query, model-response').forEach((el) => {
      const isUser = el.tagName.toLowerCase() === 'user-query';
      const body = isUser
        ? (el.querySelector('.query-text') || el)
        : (el.querySelector('message-content') || el.querySelector('.markdown') || el);
      pushTurn(turns, isUser ? 'user' : 'assistant', body.innerText || body.textContent);
    });
    return turns;
  }

  function format(siteName, turns) {
    const parts = [
      `对话来源：${siteName}`,
      `标题：${document.title || ''}`,
      `URL：${location.href}`,
      `捕获时间：${new Date().toISOString()}`,
      '',
    ];
    for (const t of turns) {
      parts.push(t.role === 'user' ? '【我】' : `【${siteName}】`);
      parts.push(t.text);
      parts.push('');
    }
    return parts.join('\n').slice(0, 60000);
  }

  // 在识别到的 AI 对话页且至少有 1 轮时返回结构化结果，否则返回 null（调用方回退到整页 innerText）
  globalThis.__omniExtractConversation = function () {
    try {
      const site = detectSite();
      if (!site) return null;
      const turns = site.extract();
      if (!turns.length) return null;
      return {
        source: site.name,
        turns: turns.length,
        lastRole: turns[turns.length - 1].role,
        content: format(site.name, turns),
        url: location.href,
        title: document.title,
      };
    } catch (e) {
      console.warn('[Omni-Context] Conversation DOM extraction failed', e);
      return null;
    }
  };

  // 自动捕获去重使用 SHA-256，避免简单 32 位哈希碰撞导致尾部内容被误判重复。
  globalThis.__omniConversationSignature = async function (data) {
    if (!data || !data.content) return '';
    if (!globalThis.crypto?.subtle) {
      throw new Error('Web Crypto is required for conversation deduplication');
    }
    const bytes = new TextEncoder().encode(data.content);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${data.turns}:${hex}`;
  };
})();
