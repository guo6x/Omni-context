import { createHash } from 'node:crypto';

export const LONGMEMEVAL_REPOSITORY = 'xiaowu0162/LongMemEval';
export const LONGMEMEVAL_COMMIT = '9e0b455f4ef0e2ab8f2e582289761153549043fc';
export const LONGMEMEVAL_VARIANT = 'longmemeval_s_cleaned';

// --- Question Date Envelope ---

export const QUESTION_ENVELOPE_VERSION = '1';

// Canonical envelope format definition (used for hash computation):
//   With date:    "Current Date: {questionDate}\nQuestion: {question}"
//   Without date: "Question: {question}"
const ENVELOPE_CANONICAL_DEFINITION = 'Current Date: {questionDate}\nQuestion: {question}|Question: {question}';
export const QUESTION_ENVELOPE_SHA256 = createHash('sha256').update(ENVELOPE_CANONICAL_DEFINITION).digest('hex');

const VALID_ROLES = new Set(['user', 'assistant']);

/**
 * Build a deterministic question envelope that prepends the current date
 * to the question. This envelope is used as the retrieval query and as
 * the scenario.question passed to the Answer Provider.
 *
 * @param {string} question - The original question text.
 * @param {string|null|undefined} questionDate - ISO date string or null.
 * @returns {string} The envelope text.
 */
export function buildLongMemEvalQuestionEnvelope(question, questionDate) {
  if (typeof question !== 'string' || question.length === 0) {
    throw new Error('ENVELOPE_QUESTION_REQUIRED');
  }
  if (questionDate && typeof questionDate === 'string' && questionDate.trim().length > 0) {
    return `Current Date: ${questionDate}\nQuestion: ${question}`;
  }
  return `Question: ${question}`;
}

// --- Official parallel-arrays normalization ---

/**
 * Normalize a LongMemEval official-format record into the internal
 * generation-projection shape.
 *
 * Official input fields (parallel arrays):
 *   question_id, question_type, question, question_date,
 *   haystack_session_ids[], haystack_dates[], haystack_sessions[][]
 *
 * haystack_sessions[i] is a Turn array: [{role, content}, ...]
 * haystack_session_ids[i], haystack_dates[i], haystack_sessions[i]
 * together describe the same session.
 *
 * Strict assertions:
 *   1. All three parallel arrays exist and are arrays.
 *   2. All three arrays have equal length.
 *   3. Session IDs are non-empty strings and unique.
 *   4. Each session (haystack_sessions[i]) is an array.
 *   5. Each turn has a valid role ("user"|"assistant") and string content.
 *   6. has_answer and all non-role/content fields are auto-discarded.
 *   7. Official array order is preserved (no re-sorting).
 *   8. answer and answer_session_ids are never read.
 *   9. Output passes assertGoldFree.
 */
export function normalizeLongMemEvalGeneration(record) {
  if (!record || typeof record !== 'object') throw new Error('LONGMEMEVAL_RECORD_INVALID');
  if (!record.question_id || typeof record.question_id !== 'string') throw new Error('LONGMEMEVAL_QUESTION_ID_REQUIRED');
  if (!record.question || typeof record.question !== 'string') throw new Error('LONGMEMEVAL_QUESTION_REQUIRED');

  const ids = record.haystack_session_ids;
  const dates = record.haystack_dates;
  const sessions = record.haystack_sessions;

  // Assertion 1: all three arrays exist and are arrays
  if (!Array.isArray(ids)) throw new Error('LONGMEMEVAL_HAYSTACK_SESSION_IDS_REQUIRED');
  if (!Array.isArray(dates)) throw new Error('LONGMEMEVAL_HAYSTACK_DATES_REQUIRED');
  if (!Array.isArray(sessions)) throw new Error('LONGMEMEVAL_HAYSTACK_SESSIONS_REQUIRED');

  // Assertion 2: all three arrays have equal length
  if (ids.length !== dates.length || ids.length !== sessions.length) {
    throw new Error('LONGMEMEVAL_PARALLEL_ARRAYS_LENGTH_MISMATCH');
  }

  // Assertion 3: session IDs are non-empty strings and unique
  const seenIds = new Set();
  for (const id of ids) {
    if (typeof id !== 'string' || id.length === 0) throw new Error('LONGMEMEVAL_SESSION_ID_EMPTY');
    if (seenIds.has(id)) throw new Error(`LONGMEMEVAL_SESSION_ID_DUPLICATE:${id}`);
    seenIds.add(id);
  }

  // Build sessions preserving official order (Assertion 7: no re-sorting)
  const normalizedSessions = sessions.map((turns, index) => {
    // Assertion 4: each session is an array
    if (!Array.isArray(turns)) throw new Error(`LONGMEMEVAL_SESSION_NOT_ARRAY:${index}`);

    // Assertion 5: each turn has valid role and string content
    // Assertion 6: auto-discard has_answer and all non-role/content fields
    const messages = turns.map((turn, turnIndex) => {
      if (!turn || typeof turn !== 'object') throw new Error(`LONGMEMEVAL_TURN_INVALID:${index}.${turnIndex}`);
      const { role, content } = turn;
      if (!VALID_ROLES.has(role)) throw new Error(`LONGMEMEVAL_TURN_ROLE_INVALID:${index}.${turnIndex}:${String(role)}`);
      if (typeof content !== 'string') throw new Error(`LONGMEMEVAL_TURN_CONTENT_INVALID:${index}.${turnIndex}`);
      // Only extract role and content; all other fields (has_answer, etc.) are discarded
      return { role, content };
    });

    return {
      session_id: ids[index],
      timestamp: dates[index],
      messages,
    };
  });

  return {
    id: record.question_id,
    question_type: record.question_type || null,
    question: record.question,
    question_date: record.question_date || null,
    sessions: normalizedSessions,
  };
}

export function toLongMemEvalOfficialOutput(record, answer, diagnostics = {}) {
  return { question_id: record.id, hypothesis: answer, abstained: answer === null, diagnostics };
}
