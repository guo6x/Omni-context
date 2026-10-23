import assert from 'node:assert/strict';
import test from 'node:test';
import { createAskAnswerBookmark, type PersistedAnswerTurn } from '../src/lib/answer-turn-compat';

const labels = {
  title: 'Ask bookmark · AI-generated, not user-confirmed',
  summaryPrefix: 'AI answer (unconfirmed)',
  note: 'Retrieved memory IDs are not independent verification of original materials.',
};

test('saved Ask answer retains provenance, grounding, and cited memory IDs without asserting user confirmation', () => {
  const turn: PersistedAnswerTurn = {
    question: 'Why did I choose this project?',
    conclusion: 'A reason\nwith a second line.',
    reasons: [{ text: 'The project fits a stated goal.', entityIds: ['goal-1'] }],
    questions: [],
    isDecision: true,
    sources: [{ id: 'goal-1', name: 'Personal goal', type: 'principle' }],
    citedEntityIds: ['goal-1', 'decision-2'],
    grounding: {
      status: 'grounded',
      answerClassification: 'inference',
      evidenceCoverage: 'partial',
      confidence: 0.72,
    },
    savedDecisionId: 'decision-3',
  };

  const bookmark = createAskAnswerBookmark(turn, labels);
  const record = JSON.parse(bookmark.content.slice(bookmark.content.indexOf('\n') + 1));

  assert.equal(record.user_confirmed, false);
  assert.equal(record.record_type, 'omni_ask_answer');
  assert.equal(record.answer_classification, 'inference');
  assert.equal(record.grounding_status, 'grounded');
  assert.equal(record.cited_sources.length, 2);
  assert.deepEqual(record.cited_sources[0], { id: 'goal-1', name: 'Personal goal' });
  assert.deepEqual(record.cited_sources[1], { id: 'decision-2', name: null });
  assert.equal(record.linked_user_decision_id, 'decision-3');
  assert.deepEqual(record.reasons[0].cited_entity_ids, ['goal-1']);
  assert.match(record.conclusion, /second line/);
  assert.ok(bookmark.tags.includes('收藏'));
  assert.ok(bookmark.tags.includes('authority:ai_derived'));
  assert.ok(bookmark.tags.includes('confirmation:unconfirmed'));
});

test('bookmark does not invent a classification or source when grounding is unavailable', () => {
  const bookmark = createAskAnswerBookmark({
    question: 'What is still unknown?',
    conclusion: 'I do not have enough context.',
    reasons: [],
    questions: [],
    isDecision: false,
    sources: [],
    citedEntityIds: [],
  }, labels);
  const record = JSON.parse(bookmark.content.slice(bookmark.content.indexOf('\n') + 1));

  assert.equal(record.answer_classification, 'unavailable');
  assert.equal(record.grounding_status, 'unavailable');
  assert.deepEqual(record.cited_sources, []);
  assert.equal(record.user_confirmed, false);
});
