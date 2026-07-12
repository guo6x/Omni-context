import { readFile } from 'node:fs/promises';
import { sha256File } from './integrity.mjs';

/**
 * Official LoCoMo data format (snap-research/locomo):
 * Top-level: array of conversation objects.
 * Each element: {
 *   sample_id, conversation: { speaker_a, speaker_b,
 *     session_1: [{ speaker, dia_id, text }, ...],
 *     session_1_date_time: "2023-04-06 16:05:00",
 *     session_2: [...], session_2_date_time: "...", ...
 *   },
 *   qa: [{ question, answer, category: 1|2|3|4|5, evidence: ["D1:3", ...] }],
 *   observation: {...}, session_summary: {...}, event_summary: {...}
 * }
 *
 * Category mapping: 1=single-hop, 2=temporal, 3=multi-hop, 4=open-domain, 5=adversarial
 */

export const CATEGORY_MAP = {
  1: 'single_hop',
  2: 'temporal',
  3: 'multi_hop',
  4: 'open_domain',
  5: 'adversarial',
};

export function mapCategory(categoryNum) {
  return CATEGORY_MAP[Number(categoryNum)] || `cat_${categoryNum}`;
}

export function isAdversarial(qa) {
  const cat = Number(qa.category);
  if (cat === 5) return true;
  const ans = String(qa.answer || '').toLowerCase().trim();
  return ans === 'unknown' || ans === 'unanswerable' || ans === 'n/a';
}

export function isUnanswerable(qa) {
  return isAdversarial(qa) || (Array.isArray(qa.evidence) && qa.evidence.length === 0 && String(qa.answer || '').toLowerCase().trim() === 'unknown');
}

/**
 * Load and validate a LoCoMo dataset file.
 * Supports both official format (top-level array) and legacy format ({ conversations: [...] }).
 */
export async function loadLoCoMo(datasetPath) {
  const raw = await readFile(datasetPath, 'utf8');
  const data = JSON.parse(raw);
  if (Array.isArray(data)) {
    return { conversations: data, _format: 'official_array' };
  }
  if (data && Array.isArray(data.conversations)) {
    return { conversations: data.conversations, _format: 'legacy_object' };
  }
  throw new Error(
    'LoCoMo dataset must be a top-level array (official format) or an object with a conversations array. ' +
    `Got: ${typeof data} ${Array.isArray(data) ? `array[${data.length}]` : `keys=${Object.keys(data || {}).slice(0, 5).join(',')}`}`
  );
}

export async function verifyDatasetHash(datasetPath, expectedHash) {
  const actual = await sha256File(datasetPath);
  if (expectedHash && actual !== expectedHash) {
    throw new Error(
      `Dataset hash mismatch: expected ${expectedHash}, got ${actual}. ` +
      'The dataset file has changed or is corrupted.'
    );
  }
  return actual;
}

export function verifyDatasetCommit(expectedCommit) {
  return expectedCommit;
}

/**
 * Get a conversation by 1-based index (official LoCoMo numbering).
 * Falls back to searching by sample_id or id field for legacy formats.
 */
export function getConversation(dataset, conversationId) {
  const id = Number(conversationId);
  const convs = dataset.conversations || dataset;
  if (!Array.isArray(convs)) {
    throw new Error('Dataset conversations is not an array');
  }
  // 1-based index into the array (official LoCoMo convention)
  if (id >= 1 && id <= convs.length) {
    return convs[id - 1];
  }
  // Fallback: search by sample_id or id
  const found = convs.find(
    (c) => Number(c.sample_id) === id || Number(c.id) === id || Number(c.conversation_id) === id
  );
  if (!found) {
    throw new Error(`Conversation ${conversationId} not found in dataset (array length: ${convs.length})`);
  }
  return found;
}

/**
 * Get QA list for a conversation.
 * In official format, qa is on the conversation object itself.
 */
export function getConversationQAs(dataset, conversationId) {
  const conv = typeof conversationId === 'object' && conversationId !== null
    ? conversationId
    : getConversation(dataset, conversationId);
  return conv.qa || conv.qa_pairs || [];
}

/**
 * Extract sessions from a conversation object in official LoCoMo format.
 * Looks for conversation.session_1, session_2, etc. with corresponding date_time fields.
 * Returns sessions sorted by session number (chronological order).
 */
export function getSessions(conv) {
  const conversationObj = conv.conversation || conv;
  if (!conversationObj || typeof conversationObj !== 'object') {
    return [];
  }
  const sessions = [];
  for (const key of Object.keys(conversationObj)) {
    const match = key.match(/^session_(\d+)$/);
    if (!match) continue;
    const sessionNum = parseInt(match[1], 10);
    const turns = conversationObj[key];
    if (!Array.isArray(turns) || turns.length === 0) continue;
    const dateTimeKey = `session_${sessionNum}_date_time`;
    const dateTime = conversationObj[dateTimeKey] || '';
    sessions.push({
      session_id: sessionNum,
      turns,
      date_time: dateTime,
      timestamp: dateTime ? parseLoCoMoDate(dateTime) : null,
    });
  }
  // Sort by session number (which represents chronological order in official format)
  sessions.sort((a, b) => a.session_id - b.session_id);
  return sessions;
}

/**
 * Parse a LoCoMo date_time string (e.g., "2023-04-06 16:05:00") into ISO format.
 */
function parseLoCoMoDate(dateTimeStr) {
  if (!dateTimeStr) return null;
  // LoCoMo format: "2023-04-06 16:05:00"
  const iso = dateTimeStr.replace(' ', 'T') + (dateTimeStr.endsWith('Z') ? '' : 'Z');
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Get speaker names from a conversation.
 */
export function getSpeakers(conv) {
  const conversationObj = conv.conversation || conv;
  return {
    speaker_a: conversationObj.speaker_a || conversationObj.speakerA || 'Speaker A',
    speaker_b: conversationObj.speaker_b || conversationObj.speakerB || 'Speaker B',
  };
}

/**
 * Format a session's turns into text suitable for GraphRAG extraction.
 * Each turn is formatted as "SpeakerName [date_anchor]: text".
 */
export function formatSessionText(session, conv) {
  const { speaker_a, speaker_b } = getSpeakers(conv);
  const dateAnchor = session.date_time || '';
  const lines = session.turns.map((turn) => {
    const speaker = turn.speaker === 'A' ? speaker_a
      : turn.speaker === 'B' ? speaker_b
      : (turn.speaker || turn.name || 'Unknown');
    const text = turn.text || turn.content || turn.message || '';
    return `${speaker} [${dateAnchor}]: ${text}`;
  });
  const convId = conv.sample_id || conv.id || conv.conversation_id || '?';
  const header = `[Conversation ${convId}, Session ${session.session_id}${dateAnchor ? ', ' + dateAnchor : ''}]`;
  return `${header}\n\n${lines.join('\n')}`;
}

/**
 * Generate a stable question ID.
 * Format: conv{N}-q{index} (e.g., conv1-q0, conv1-q1).
 */
export function generateQuestionId(convId, qa, qaIndex) {
  if (qa.question_id !== undefined) return `conv${convId}-q${qa.question_id}`;
  return `conv${convId}-q${qaIndex}`;
}

/**
 * Get the total number of conversations in the dataset.
 */
export function getConversationCount(dataset) {
  const convs = dataset.conversations || dataset;
  return Array.isArray(convs) ? convs.length : 0;
}
