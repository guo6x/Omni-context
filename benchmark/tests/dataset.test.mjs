import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  loadLoCoMo,
  getConversation,
  getConversationQAs,
  getSessions,
  formatSessionText,
  getSpeakers,
  generateQuestionId,
  mapCategory,
  isAdversarial,
  isUnanswerable,
  CATEGORY_MAP,
  getConversationCount,
} from '../src/dataset.mjs';

/**
 * Fixture matching the official LoCoMo format (snap-research/locomo).
 * Top-level array; each element has:
 *   - conversation: { speaker_a, speaker_b, session_1: [...], session_1_date_time, ... }
 *   - qa: [{ question, answer, category, evidence }]
 */
const OFFICIAL_FIXTURE = [
  {
    sample_id: 1,
    conversation: {
      speaker_a: 'Alice',
      speaker_b: 'Bob',
      session_1: [
        { speaker: 'A', dia_id: 'D1:1', text: 'Hi, I just moved to San Francisco.' },
        { speaker: 'B', dia_id: 'D1:2', text: 'Welcome! What do you do for work?' },
        { speaker: 'A', dia_id: 'D1:3', text: 'I am a software engineer at a startup.' },
      ],
      session_1_date_time: '2023-04-06 16:05:00',
      session_2: [
        { speaker: 'A', dia_id: 'D2:1', text: 'I started learning pottery last week.' },
        { speaker: 'B', dia_id: 'D2:2', text: 'That sounds fun! Where are you taking classes?' },
      ],
      session_2_date_time: '2023-04-20 14:40:00',
    },
    qa: [
      { question: 'Where does Alice live?', answer: 'San Francisco', category: 1, evidence: ['D1:1'] },
      { question: 'When did Alice start pottery?', answer: 'The week before 20 April 2023', category: 2, evidence: ['D2:1'] },
      { question: 'What is Alice likely to pursue as a hobby?', answer: 'Pottery', category: 3, evidence: ['D2:1', 'D1:1'] },
      { question: 'What is the capital of France?', answer: 'unknown', category: 5, evidence: [] },
    ],
    observation: {},
    session_summary: {},
  },
  {
    sample_id: 2,
    conversation: {
      speaker_a: 'Carol',
      speaker_b: 'Dave',
      session_1: [
        { speaker: 'A', dia_id: 'D1:1', text: 'I love hiking.' },
      ],
      session_1_date_time: '2023-05-01 10:00:00',
    },
    qa: [
      { question: 'What does Carol like?', answer: 'Hiking', category: 1, evidence: ['D1:1'] },
    ],
  },
];

test('loadLoCoMo parses official top-level array format', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'locomo-test-'));
  const filePath = path.join(tmpDir, 'locomo10.json');
  await writeFile(filePath, JSON.stringify(OFFICIAL_FIXTURE));

  const dataset = await loadLoCoMo(filePath);
  assert.strictEqual(dataset._format, 'official_array');
  assert.strictEqual(dataset.conversations.length, 2);
});

test('loadLoCoMo rejects invalid format', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'locomo-test-'));
  const filePath = path.join(tmpDir, 'invalid.json');
  await writeFile(filePath, JSON.stringify({ foo: 'bar' }));

  await assert.rejects(
    () => loadLoCoMo(filePath),
    /must be a top-level array/
  );
});

test('getConversation returns conversation by 1-based index', () => {
  const dataset = { conversations: OFFICIAL_FIXTURE };
  const conv1 = getConversation(dataset, 1);
  assert.strictEqual(conv1.conversation.speaker_a, 'Alice');
  const conv2 = getConversation(dataset, 2);
  assert.strictEqual(conv2.conversation.speaker_a, 'Carol');
});

test('getConversation throws for out-of-range index', () => {
  const dataset = { conversations: OFFICIAL_FIXTURE };
  assert.throws(() => getConversation(dataset, 99), /not found/);
});

test('getSessions extracts sessions in chronological order', () => {
  const conv = OFFICIAL_FIXTURE[0];
  const sessions = getSessions(conv);
  assert.strictEqual(sessions.length, 2);
  assert.strictEqual(sessions[0].session_id, 1);
  assert.strictEqual(sessions[1].session_id, 2);
  assert.strictEqual(sessions[0].date_time, '2023-04-06 16:05:00');
  assert.strictEqual(sessions[1].date_time, '2023-04-20 14:40:00');
});

test('getSessions parses date_time into ISO timestamp', () => {
  const conv = OFFICIAL_FIXTURE[0];
  const sessions = getSessions(conv);
  assert.ok(sessions[0].timestamp);
  assert.strictEqual(sessions[0].timestamp, '2023-04-06T16:05:00.000Z');
});

test('getSessions handles conversation without sessions', () => {
  const sessions = getSessions({ conversation: { speaker_a: 'X' } });
  assert.strictEqual(sessions.length, 0);
});

test('getConversationQAs returns qa array from conversation', () => {
  const dataset = { conversations: OFFICIAL_FIXTURE };
  const qas = getConversationQAs(dataset, 1);
  assert.strictEqual(qas.length, 4);
  assert.strictEqual(qas[0].question, 'Where does Alice live?');
});

test('getConversationQAs accepts conversation object directly', () => {
  const conv = OFFICIAL_FIXTURE[0];
  const qas = getConversationQAs(null, conv);
  assert.strictEqual(qas.length, 4);
});

test('getSpeakers returns speaker names', () => {
  const conv = OFFICIAL_FIXTURE[0];
  const speakers = getSpeakers(conv);
  assert.strictEqual(speakers.speaker_a, 'Alice');
  assert.strictEqual(speakers.speaker_b, 'Bob');
});

test('formatSessionText formats turns with speaker names and date anchors', () => {
  const conv = OFFICIAL_FIXTURE[0];
  const sessions = getSessions(conv);
  const text = formatSessionText(sessions[0], conv);
  assert.ok(text.includes('Alice [2023-04-06 16:05:00]:'));
  assert.ok(text.includes('Bob [2023-04-06 16:05:00]:'));
  assert.ok(text.includes('San Francisco'));
  assert.ok(text.includes('[Conversation 1, Session 1'));
});

test('formatSessionText handles speaker B correctly', () => {
  const conv = OFFICIAL_FIXTURE[0];
  const sessions = getSessions(conv);
  const text = formatSessionText(sessions[0], conv);
  assert.ok(text.includes('Bob '));
  assert.ok(text.includes('What do you do for work?'));
});

test('mapCategory maps category numbers to names', () => {
  assert.strictEqual(mapCategory(1), 'single_hop');
  assert.strictEqual(mapCategory(2), 'temporal');
  assert.strictEqual(mapCategory(3), 'multi_hop');
  assert.strictEqual(mapCategory(4), 'open_domain');
  assert.strictEqual(mapCategory(5), 'adversarial');
});

test('isAdversarial identifies category 5', () => {
  assert.ok(isAdversarial({ category: 5 }));
  assert.ok(!isAdversarial({ category: 1 }));
  assert.ok(isAdversarial({ answer: 'unknown' }));
  assert.ok(isAdversarial({ answer: 'Unanswerable' }));
  assert.ok(!isAdversarial({ answer: 'San Francisco' }));
});

test('isUnanswerable identifies questions with no evidence and unknown answer', () => {
  assert.ok(isUnanswerable({ category: 5, evidence: [], answer: 'unknown' }));
  assert.ok(!isUnanswerable({ category: 1, evidence: ['D1:1'], answer: 'San Francisco' }));
});

test('generateQuestionId produces stable IDs', () => {
  const id1 = generateQuestionId(1, { question_id: 5 }, 0);
  assert.strictEqual(id1, 'conv1-q5');
  const id2 = generateQuestionId(1, {}, 3);
  assert.strictEqual(id2, 'conv1-q3');
});

test('getConversationCount returns array length', () => {
  const dataset = { conversations: OFFICIAL_FIXTURE };
  assert.strictEqual(getConversationCount(dataset), 2);
});

test('CATEGORY_MAP has all 5 categories', () => {
  assert.strictEqual(Object.keys(CATEGORY_MAP).length, 5);
  assert.strictEqual(CATEGORY_MAP[1], 'single_hop');
  assert.strictEqual(CATEGORY_MAP[5], 'adversarial');
});

test('full pipeline: load fixture -> parse sessions -> format text', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'locomo-test-'));
  const filePath = path.join(tmpDir, 'locomo10.json');
  await writeFile(filePath, JSON.stringify(OFFICIAL_FIXTURE));

  const dataset = await loadLoCoMo(filePath);
  const conv = getConversation(dataset, 1);
  const sessions = getSessions(conv);
  const qas = getConversationQAs(dataset, 1);

  assert.strictEqual(sessions.length, 2);
  assert.strictEqual(qas.length, 4);

  // Verify each session can be formatted as text
  for (const session of sessions) {
    const text = formatSessionText(session, conv);
    assert.ok(text.length > 50, `Session ${session.session_id} text too short`);
    assert.ok(text.includes('Alice') || text.includes('Bob'));
  }

  // Verify QA categories
  assert.strictEqual(mapCategory(qas[0].category), 'single_hop');
  assert.strictEqual(mapCategory(qas[1].category), 'temporal');
  assert.strictEqual(mapCategory(qas[2].category), 'multi_hop');
  assert.ok(isAdversarial(qas[3]));
});
