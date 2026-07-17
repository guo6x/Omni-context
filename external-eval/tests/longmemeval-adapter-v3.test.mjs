import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeLongMemEvalGeneration,
  buildLongMemEvalQuestionEnvelope,
  QUESTION_ENVELOPE_VERSION,
  QUESTION_ENVELOPE_SHA256,
} from '../adapters/longmemeval.mjs';

test('official parallel-array data structure normalizes correctly', () => {
  const record = {
    question_id: 'q1',
    question_type: 'single-session-user',
    question: 'What color?',
    question_date: '2026-01-12',
    haystack_session_ids: ['s1', 's2'],
    haystack_dates: ['2026-01-01T09:00:00Z', '2026-01-05T09:00:00Z'],
    haystack_sessions: [
      [{ role: 'user', content: 'I chose teal.' }, { role: 'assistant', content: 'Noted.' }],
      [{ role: 'user', content: 'The workshop is at noon.' }],
    ],
  };
  const result = normalizeLongMemEvalGeneration(record);
  assert.equal(result.id, 'q1');
  assert.equal(result.question_type, 'single-session-user');
  assert.equal(result.question, 'What color?');
  assert.equal(result.question_date, '2026-01-12');
  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions[0].session_id, 's1');
  assert.equal(result.sessions[0].timestamp, '2026-01-01T09:00:00Z');
  assert.equal(result.sessions[0].messages.length, 2);
  assert.equal(result.sessions[0].messages[0].role, 'user');
  assert.equal(result.sessions[0].messages[0].content, 'I chose teal.');
  assert.equal(result.sessions[1].session_id, 's2');
  assert.equal(result.sessions[1].messages.length, 1);
});

test('parallel arrays with different lengths are rejected', () => {
  const record = {
    question_id: 'q1',
    question: 'What?',
    haystack_session_ids: ['s1', 's2'],
    haystack_dates: ['2026-01-01T09:00:00Z'],
    haystack_sessions: [[{ role: 'user', content: 'Hi' }]],
  };
  assert.throws(() => normalizeLongMemEvalGeneration(record), /LONGMEMEVAL_PARALLEL_ARRAYS_LENGTH_MISMATCH/);
});

test('empty or duplicate session IDs are rejected', () => {
  const base = {
    question_id: 'q1',
    question: 'What?',
    haystack_dates: ['2026-01-01T09:00:00Z'],
    haystack_sessions: [[{ role: 'user', content: 'Hi' }]],
  };
  assert.throws(() => normalizeLongMemEvalGeneration({ ...base, haystack_session_ids: [''] }), /LONGMEMEVAL_SESSION_ID_EMPTY/);
  assert.throws(() => normalizeLongMemEvalGeneration({
    ...base,
    haystack_session_ids: ['s1', 's1'],
    haystack_dates: ['2026-01-01', '2026-01-02'],
    haystack_sessions: [[{ role: 'user', content: 'Hi' }], [{ role: 'user', content: 'Yo' }]],
  }), /LONGMEMEVAL_SESSION_ID_DUPLICATE:s1/);
});

test('has_answer and non-role/content fields are auto-discarded', () => {
  const record = {
    question_id: 'q1',
    question: 'What?',
    question_date: '2026-01-12',
    haystack_session_ids: ['s1'],
    haystack_dates: ['2026-01-01T09:00:00Z'],
    haystack_sessions: [[{ role: 'user', content: 'Hi', has_answer: true, extra_field: 'bad' }]],
    has_answer: true,
    answer: 'secret',
    answer_session_ids: ['s1'],
  };
  const result = normalizeLongMemEvalGeneration(record);
  assert.equal(result.sessions[0].messages[0].has_answer, undefined);
  assert.equal(result.sessions[0].messages[0].extra_field, undefined);
  assert.equal(result.sessions[0].messages.length, 1);
  assert.equal(result.sessions[0].messages[0].role, 'user');
  assert.equal(result.sessions[0].messages[0].content, 'Hi');
  assert.equal(result.answer, undefined);
  assert.equal(result.answer_session_ids, undefined);
});

test('question envelope includes Current Date when questionDate is provided', () => {
  const envelope = buildLongMemEvalQuestionEnvelope('What color?', '2026-01-12');
  assert.equal(envelope, 'Current Date: 2026-01-12\nQuestion: What color?');
});

test('question envelope omits Current Date when questionDate is null', () => {
  const envelope = buildLongMemEvalQuestionEnvelope('What color?', null);
  assert.equal(envelope, 'Question: What color?');
});

test('question envelope omits Current Date when questionDate is empty string', () => {
  const envelope = buildLongMemEvalQuestionEnvelope('What color?', '');
  assert.equal(envelope, 'Question: What color?');
});

test('question envelope preserves original question text exactly', () => {
  const question = 'What is the meaning of life, the universe, and everything?';
  const envelope = buildLongMemEvalQuestionEnvelope(question, '2026-01-12');
  assert.ok(envelope.includes(question));
  assert.equal(envelope, `Current Date: 2026-01-12\nQuestion: ${question}`);
});

test('question envelope rejects empty question', () => {
  assert.throws(() => buildLongMemEvalQuestionEnvelope('', '2026-01-12'), /ENVELOPE_QUESTION_REQUIRED/);
  assert.throws(() => buildLongMemEvalQuestionEnvelope(null, '2026-01-12'), /ENVELOPE_QUESTION_REQUIRED/);
});

test('envelope version and SHA-256 constants are correct', () => {
  assert.equal(QUESTION_ENVELOPE_VERSION, '1');
  assert.equal(QUESTION_ENVELOPE_SHA256, '1e26c66a675a17b74e78dd8d1c6624996143a14b47c5b8753e1c67959fdb96cc');
});

test('official session order is preserved without re-sorting', () => {
  const record = {
    question_id: 'q1',
    question: 'What?',
    haystack_session_ids: ['s3', 's1', 's2'],
    haystack_dates: ['2026-01-03', '2026-01-01', '2026-01-02'],
    haystack_sessions: [
      [{ role: 'user', content: 'third' }],
      [{ role: 'user', content: 'first' }],
      [{ role: 'user', content: 'second' }],
    ],
  };
  const result = normalizeLongMemEvalGeneration(record);
  assert.deepEqual(result.sessions.map((s) => s.session_id), ['s3', 's1', 's2']);
  assert.deepEqual(result.sessions.map((s) => s.timestamp), ['2026-01-03', '2026-01-01', '2026-01-02']);
});

test('invalid turn role is rejected', () => {
  const record = {
    question_id: 'q1',
    question: 'What?',
    haystack_session_ids: ['s1'],
    haystack_dates: ['2026-01-01'],
    haystack_sessions: [[{ role: 'system', content: 'bad' }]],
  };
  assert.throws(() => normalizeLongMemEvalGeneration(record), /LONGMEMEVAL_TURN_ROLE_INVALID/);
});

test('non-string content is rejected', () => {
  const record = {
    question_id: 'q1',
    question: 'What?',
    haystack_session_ids: ['s1'],
    haystack_dates: ['2026-01-01'],
    haystack_sessions: [[{ role: 'user', content: 123 }]],
  };
  assert.throws(() => normalizeLongMemEvalGeneration(record), /LONGMEMEVAL_TURN_CONTENT_INVALID/);
});

test('missing parallel arrays are rejected', () => {
  const base = { question_id: 'q1', question: 'What?' };
  assert.throws(() => normalizeLongMemEvalGeneration(base), /LONGMEMEVAL_HAYSTACK_SESSION_IDS_REQUIRED/);
  assert.throws(() => normalizeLongMemEvalGeneration({ ...base, haystack_session_ids: [] }), /LONGMEMEVAL_HAYSTACK_DATES_REQUIRED/);
  assert.throws(() => normalizeLongMemEvalGeneration({ ...base, haystack_session_ids: [], haystack_dates: [] }), /LONGMEMEVAL_HAYSTACK_SESSIONS_REQUIRED/);
});

test('non-array session is rejected', () => {
  const record = {
    question_id: 'q1',
    question: 'What?',
    haystack_session_ids: ['s1'],
    haystack_dates: ['2026-01-01'],
    haystack_sessions: ['not-an-array'],
  };
  assert.throws(() => normalizeLongMemEvalGeneration(record), /LONGMEMEVAL_SESSION_NOT_ARRAY/);
});
