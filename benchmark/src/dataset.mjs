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

export const LOCOMO_DATETIME_PARSER_VERSION = 'locomo-datetime-v2';
export const LOCOMO_TIMEZONE_ASSUMPTION = 'UTC for LoCoMo timestamps without an explicit timezone';

const MONTHS = Object.freeze({
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
});

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
export function getSessions(conv, options = {}) {
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
    const conversationId = options.conversationId ?? conv.sample_id ?? conv.id ?? conv.conversation_id ?? 'unknown';
    const sessionId = `conv${conversationId}/session${sessionNum}`;
    const parsed = parseLoCoMoDateTime(dateTime, {
      sessionId,
      evaluationMode: options.evaluationMode === true,
      onWarning: options.onWarning,
    });
    sessions.push({
      session_id: sessionNum,
      turns,
      date_time: dateTime,
      timestamp: parsed.parsed_timestamp,
      raw_date_time: parsed.raw_date_time,
      parsed_timestamp: parsed.parsed_timestamp,
      parser_version: parsed.parser_version,
      timezone_assumption: parsed.timezone_assumption,
    });
  }

  const numberedOrder = [...sessions].sort((a, b) => a.session_id - b.session_id);
  const timestampOrder = [...sessions]
    .filter((session) => session.parsed_timestamp)
    .sort((a, b) => a.parsed_timestamp.localeCompare(b.parsed_timestamp) || a.session_id - b.session_id);
  const comparableNumberedOrder = numberedOrder.filter((session) => session.parsed_timestamp);
  const orderConflict = comparableNumberedOrder.some(
    (session, index) => session.session_id !== timestampOrder[index]?.session_id,
  );
  if (orderConflict) {
    emitDateWarning(options.onWarning,
      `[LoCoMoDateParser] conversation_id=${options.conversationId ?? conv.sample_id ?? conv.id ?? 'unknown'} ` +
      `session_number_order=${comparableNumberedOrder.map((s) => s.session_id).join(',')} ` +
      `parsed_time_order=${timestampOrder.map((s) => s.session_id).join(',')}`);
  }

  sessions.sort((a, b) => {
    if (a.parsed_timestamp && b.parsed_timestamp) {
      return a.parsed_timestamp.localeCompare(b.parsed_timestamp) || a.session_id - b.session_id;
    }
    if (a.parsed_timestamp) return -1;
    if (b.parsed_timestamp) return 1;
    return a.session_id - b.session_id;
  });
  return sessions;
}

/**
 * Parse a LoCoMo date/time without relying on implementation-dependent Date string parsing.
 * Timestamps with no explicit timezone are interpreted as UTC so evaluation is identical
 * across machines. The returned metadata is persisted with each ingested session.
 */
export function parseLoCoMoDateTime(dateTimeStr, options = {}) {
  const raw = typeof dateTimeStr === 'string' ? dateTimeStr : String(dateTimeStr ?? '');
  const value = raw.trim();
  const sessionId = options.sessionId ?? 'unknown';

  const fail = (reason) => {
    const message = `[LoCoMoDateParser] session_id=${sessionId} raw_date_time=${JSON.stringify(raw)} error=${reason}`;
    emitDateWarning(options.onWarning, message);
    if (options.evaluationMode === true) {
      throw new Error(message);
    }
    return {
      raw_date_time: raw,
      parsed_timestamp: null,
      parser_version: LOCOMO_DATETIME_PARSER_VERSION,
      timezone_assumption: LOCOMO_TIMEZONE_ASSUMPTION,
    };
  };

  if (!value) return fail('missing date/time');

  let parts;
  let timezoneAssumption = LOCOMO_TIMEZONE_ASSUMPTION;

  // ISO/calendar formats: YYYY-MM-DD, YYYY-MM-DD HH:mm:ss, and ISO with Z/offset.
  const isoMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i,
  );
  if (isoMatch) {
    const [, year, month, day, hour = '0', minute = '0', second = '0', fraction = '', zone = ''] = isoMatch;
    parts = {
      year: Number(year), month: Number(month), day: Number(day),
      hour: Number(hour), minute: Number(minute), second: Number(second),
      millisecond: Number((fraction + '000').slice(0, 3)),
      zone,
    };
    if (zone) timezoneAssumption = zone.toUpperCase() === 'Z' ? 'explicit UTC (Z)' : `explicit offset ${normalizeOffset(zone)}`;
  }

  // Official natural-language format: "7:48 pm on 21 May, 2023".
  if (!parts) {
    const natural = value.match(/^(\d{1,2}):(\d{2})\s*(am|pm)\s+on\s+(\d{1,2})\s+([A-Za-z.]+),?\s+(\d{4})$/i);
    if (natural) {
      const [, rawHour, minute, meridiem, day, monthName, year] = natural;
      const month = parseEnglishMonth(monthName);
      if (!month) return fail(`unknown English month ${JSON.stringify(monthName)}`);
      let hour = Number(rawHour);
      if (hour < 1 || hour > 12) return fail(`12-hour clock hour out of range: ${rawHour}`);
      if (meridiem.toLowerCase() === 'am') hour = hour === 12 ? 0 : hour;
      else hour = hour === 12 ? 12 : hour + 12;
      parts = {
        year: Number(year), month, day: Number(day), hour,
        minute: Number(minute), second: 0, millisecond: 0, zone: '',
      };
    }
  }

  // Dates without a clock: "21 May, 2023" or "May 21, 2023".
  if (!parts) {
    const dayFirst = value.match(/^(\d{1,2})\s+([A-Za-z.]+),?\s+(\d{4})$/i);
    const monthFirst = value.match(/^([A-Za-z.]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
    const match = dayFirst || monthFirst;
    if (match) {
      const monthName = dayFirst ? match[2] : match[1];
      const month = parseEnglishMonth(monthName);
      if (!month) return fail(`unknown English month ${JSON.stringify(monthName)}`);
      parts = {
        year: Number(match[3]), month,
        day: Number(dayFirst ? match[1] : match[2]),
        hour: 0, minute: 0, second: 0, millisecond: 0, zone: '',
      };
    }
  }

  if (!parts) return fail('unsupported date/time format');
  const validationError = validateDateParts(parts);
  if (validationError) return fail(validationError);

  let timestampMs = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour, parts.minute, parts.second, parts.millisecond,
  );
  if (parts.zone && parts.zone.toUpperCase() !== 'Z') {
    timestampMs -= parseOffsetMinutes(parts.zone) * 60_000;
  }

  return {
    raw_date_time: raw,
    parsed_timestamp: new Date(timestampMs).toISOString(),
    parser_version: LOCOMO_DATETIME_PARSER_VERSION,
    timezone_assumption: timezoneAssumption,
  };
}

function parseEnglishMonth(value) {
  return MONTHS[value.toLowerCase().replace(/\.$/, '')] || null;
}

function normalizeOffset(value) {
  const compact = value.replace(':', '');
  return `${compact.slice(0, 3)}:${compact.slice(3)}`;
}

function parseOffsetMinutes(value) {
  const normalized = normalizeOffset(value);
  const sign = normalized[0] === '-' ? -1 : 1;
  return sign * (Number(normalized.slice(1, 3)) * 60 + Number(normalized.slice(4, 6)));
}

function validateDateParts(parts) {
  if (parts.year < 1 || parts.year > 9999) return `year out of range: ${parts.year}`;
  if (parts.month < 1 || parts.month > 12) return `month out of range: ${parts.month}`;
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  if (parts.day < 1 || parts.day > daysInMonth) return `day out of range: ${parts.day}`;
  if (parts.hour < 0 || parts.hour > 23) return `hour out of range: ${parts.hour}`;
  if (parts.minute < 0 || parts.minute > 59) return `minute out of range: ${parts.minute}`;
  if (parts.second < 0 || parts.second > 59) return `second out of range: ${parts.second}`;
  if (parts.zone && parts.zone.toUpperCase() !== 'Z') {
    const normalized = normalizeOffset(parts.zone);
    const offsetHours = Number(normalized.slice(1, 3));
    const offsetMinutes = Number(normalized.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) return `timezone offset out of range: ${parts.zone}`;
  }
  return null;
}

function emitDateWarning(onWarning, message) {
  if (typeof onWarning === 'function') onWarning(message);
  else console.warn(message);
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
