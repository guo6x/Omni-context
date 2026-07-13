// 解析主流 AI 的聊天记录导出文件 → 统一的对话列表，供导入大脑。
// 支持：ChatGPT(conversations.json)、Claude(conversations.json)、Gemini(Google Takeout / My Activity)。
// 设计为「自动识别 + 宽容解析」：拿不准的字段尽量兜底，不因个别异常整体失败。

export interface ParsedConversation {
  title: string;
  text: string;      // 已格式化为「用户: ... / 助手: ...」的多轮文本
  time?: string;     // ISO；用于导入后按时间召回
}

export interface ParsedChatExport {
  platform: 'chatgpt' | 'claude' | 'gemini' | 'generic';
  conversations: ParsedConversation[];
}

function toIso(t: any): string | undefined {
  if (t == null) return undefined;
  if (typeof t === 'number') return new Date(t * (t > 1e12 ? 1 : 1000)).toISOString();
  const d = new Date(t);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function turnsToText(turns: Array<{ role: string; text: string }>): string {
  return turns
    .filter((t) => t.text && t.text.trim())
    .map((t) => `${t.role === 'assistant' ? '助手' : '用户'}: ${t.text.trim()}`)
    .join('\n\n');
}

// ── ChatGPT: conversations.json，每条会话是 mapping 节点树 ──
function parseChatGPTConv(conv: any): ParsedConversation {
  const turns: Array<{ role: string; text: string; t: number }> = [];
  const mapping = conv?.mapping || {};
  for (const k of Object.keys(mapping)) {
    const msg = mapping[k]?.message;
    if (!msg) continue;
    const role = msg.author?.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const parts = msg.content?.parts;
    const text = Array.isArray(parts) ? parts.filter((p: any) => typeof p === 'string').join('\n') : '';
    if (!text.trim()) continue;
    turns.push({ role, text, t: msg.create_time || 0 });
  }
  turns.sort((a, b) => a.t - b.t);
  return {
    title: (conv.title || '未命名对话').toString(),
    text: turnsToText(turns),
    time: toIso(conv.create_time) || toIso(turns[0]?.t),
  };
}

// ── Claude: conversations.json，每条会话有 chat_messages ──
function parseClaudeConv(conv: any): ParsedConversation {
  const msgs = conv.chat_messages || conv.chatMessages || [];
  const turns = msgs.map((m: any) => {
    let text = typeof m.text === 'string' ? m.text : '';
    if (!text && Array.isArray(m.content)) {
      text = m.content.map((c: any) => c?.text || '').filter(Boolean).join('\n');
    }
    return { role: m.sender === 'assistant' ? 'assistant' : 'user', text };
  });
  return {
    title: (conv.name || conv.title || '未命名对话').toString(),
    text: turnsToText(turns),
    time: toIso(conv.created_at),
  };
}

// ── Gemini: Google Takeout 的 My Activity（每条是一次提问/活动）──
function parseGeminiActivity(items: any[]): ParsedConversation[] {
  const out: ParsedConversation[] = [];
  for (const it of items) {
    let title = (it.title || '').toString();
    // 常见前缀「Prompted ...」/「已询问」等，剥掉只留提问内容
    title = title.replace(/^(Prompted|已询问|Asked|搜索了|Searched for)\s*/i, '').trim();
    if (!title) continue;
    out.push({ title: title.slice(0, 60), text: `用户: ${title}`, time: toIso(it.time) });
  }
  return out;
}

// ── HTML 导出解析 ──

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ChatGPT 导出的 chat.html 内嵌 `var jsonData = [...]`，把这段数组抠出来（字符串感知的括号匹配）
function extractChatGPTJson(html: string): any[] | null {
  const idx = html.indexOf('jsonData');
  if (idx === -1) return null;
  const start = html.indexOf('[', idx);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false, quote = '';
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; }
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// 把答案的富 HTML 压成可读纯文本（保留分段/列表/表格的换行）
function htmlToText(html: string): string {
  const s = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '· ')
    .replace(/<\/(td|th)>/gi, ' ')
    .replace(/<\/(p|h[1-6]|li|tr|ul|ol|blockquote|div|table|thead|tbody)>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(s).replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 活动时间：中文「2026年6月4日 17:18:31 JST」/ 英文「Jun 4, 2026, 10:11:05 AM GMT+8」
function parseActivityTime(ts: string): string | undefined {
  const cn = ts.match(/(\d{4})年(\d{1,2})月(\d{1,2})日[^\d]*(\d{1,2}):(\d{2}):(\d{2})/);
  if (cn) {
    const d = new Date(+cn[1], +cn[2] - 1, +cn[3], +cn[4], +cn[5], +cn[6]);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  return toIso(ts.replace(/\s*(GMT|UTC|JST|PST|PDT|EST|EDT|CST)[^\s]*\s*$/i, '').trim());
}

// 从 div 内部起点做深度感知匹配，取出该 div 的内部 HTML（答案里可能含嵌套 div）
function extractDivInner(html: string, innerStart: number): { inner: string; end: number } | null {
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = innerStart;
  let depth = 1, t: RegExpExecArray | null;
  while ((t = tagRe.exec(html)) !== null) {
    if (t[0].charAt(1) === '/') { if (--depth === 0) return { inner: html.slice(innerStart, t.index), end: tagRe.lastIndex }; }
    else depth++;
  }
  return null;
}

// 时间戳 token：中文「2026年6月4日 17:18:31 JST」/ 英文「Jun 4, 2026, 10:11:05 AM GMT+8」
const ACTIVITY_TS = /(\d{4}年\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}:\d{2}(?:\s*[A-Za-z]{2,5})?|[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M(?:\s*GMT[+\-\d:]*)?)/;

// Google Takeout「My Activity」HTML（Gemini Apps）：body-1 单元 =「Prompted 提问<br>(可选附件/时间)<br>答案HTML」。
// 结构不固定（有的没时间戳、夹着"Attached 1 file."），所以用时间戳锚点切答案，没锚点就整段当答案——绝不丢答案正文。
function parseGoogleActivityHtml(html: string): ParsedConversation[] {
  const out: ParsedConversation[] = [];
  const openRe = /<div[^>]*class="[^"]*content-cell[^"]*mdl-typography--body-1[^"]*"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(html)) !== null) {
    const got = extractDivInner(html, m.index + m[0].length);
    if (!got) continue;
    openRe.lastIndex = got.end; // 跳过整段答案，别把答案里的内容当成新单元
    const inner = got.inner;

    const br1 = inner.search(/<br\s*\/?>/i);
    if (br1 < 0) continue;
    const prompt = stripTags(inner.slice(0, br1)).replace(/^(Prompted|已询问|Asked|Searched for|搜索了|已搜索)\s*/i, '').trim();
    if (!prompt) continue;

    const rest = inner.slice(br1);
    // 时间戳总在提问后不远，限窗 400 字避免命中答案正文里的日期
    const tm = rest.slice(0, 400).match(ACTIVITY_TS);
    let time: string | undefined;
    let answerHtml: string;
    if (tm && tm.index !== undefined) {
      time = parseActivityTime(tm[1]);
      answerHtml = rest.slice(tm.index + tm[0].length);
    } else {
      answerHtml = rest;
    }
    const answer = htmlToText(answerHtml);

    const turns = [{ role: 'user', text: prompt }];
    if (answer) turns.push({ role: 'assistant', text: answer });
    out.push({ title: prompt.replace(/\s+/g, ' ').slice(0, 60), text: turnsToText(turns), time });
  }
  return out;
}

export function parseChatExport(raw: string): ParsedChatExport {
  // HTML 导出：ChatGPT chat.html（内嵌完整 JSON）/ Gemini My Activity HTML
  if (raw.trimStart().startsWith('<')) {
    const cg = extractChatGPTJson(raw);
    if (cg && cg.length && cg[0]?.mapping) {
      return { platform: 'chatgpt', conversations: cg.map(parseChatGPTConv).filter((c) => c.text) };
    }
    const convs = parseGoogleActivityHtml(raw);
    if (convs.length === 0) {
      throw new Error('HTML 里没识别到对话。ChatGPT 请用 conversations.json 或 chat.html；Gemini 请用 Google Takeout 的「My Activity」HTML');
    }
    return { platform: 'gemini', conversations: convs };
  }

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('无法解析：请上传 JSON 或 HTML 格式的导出文件（ChatGPT/Claude 的 conversations.json、chat.html，或 Gemini 的 My Activity）');
  }

  const arr: any[] | null = Array.isArray(data)
    ? data
    : Array.isArray(data.conversations) ? data.conversations : null;
  if (!arr || arr.length === 0) throw new Error('导出文件里没有可识别的对话');

  const s = arr[0] || {};
  if (s.mapping) {
    return { platform: 'chatgpt', conversations: arr.map(parseChatGPTConv).filter((c) => c.text) };
  }
  if (s.chat_messages || s.chatMessages) {
    return { platform: 'claude', conversations: arr.map(parseClaudeConv).filter((c) => c.text) };
  }
  if (s.title !== undefined && (s.time !== undefined || s.header !== undefined)) {
    return { platform: 'gemini', conversations: parseGeminiActivity(arr) };
  }
  // 兜底：通用 [{role|sender, content|text}] 单列对话
  if (s.role || s.sender || s.content || s.text) {
    const turns = arr.map((m: any) => ({
      role: (m.role || m.sender) === 'assistant' ? 'assistant' : 'user',
      text: (typeof m.content === 'string' ? m.content : m.text) || '',
    }));
    return { platform: 'generic', conversations: [{ title: '导入对话', text: turnsToText(turns) }].filter((c) => c.text) };
  }
  throw new Error('无法识别的导出格式（目前支持 ChatGPT / Claude / Gemini）');
}



