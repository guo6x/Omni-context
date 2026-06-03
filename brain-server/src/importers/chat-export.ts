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

export function parseChatExport(raw: string): ParsedChatExport {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('无法解析：请上传 JSON 格式的导出文件（ChatGPT/Claude 的 conversations.json 或 Gemini 的 My Activity JSON）');
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
