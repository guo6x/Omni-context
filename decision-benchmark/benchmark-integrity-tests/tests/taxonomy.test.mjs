import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSample } from '../lib/reference-scorer.mjs';

function sample(overrides = {}) {
  return {
    schema_version: 'decision-benchmark-v1',
    sample_id: 'dev-999',
    task_type: 1,
    title: 't',
    narrative: 'n',
    memory_timeline: [{ t: '2026-01-01T00:00:00Z', kind: 'goal', content: 'g' }],
    goal: 'g',
    candidates: [{ id: 'a', label: 'A', description: 'd' }, { id: 'b', label: 'B', description: 'd' }],
    hard_constraints: [],
    soft_preferences: [],
    valid_evidence: [{ entity_id: 'ev-1', content: 'evidence one content', temporal_status: 'current', role: 'supporting' }],
    expired_evidence: [],
    conflicting_evidence: [],
    historical_decisions: [],
    execution_results: [],
    expected_decision_action: 'decide',
    expected_action_detail: { action: 'decide', selected_candidate: 'a', clarifying_question: null, max_clarifying_questions: 0 },
    acceptable_explanation: [{ feature: 'f', must_mention: ['evidence', 'a'] }],
    severe_failure_label: 'none',
    tags: [],
    ...overrides,
  };
}

const clarifyExpected = () => sample({
  task_type: 2,
  expected_decision_action: 'clarify',
  expected_action_detail: { action: 'clarify', selected_candidate: null, clarifying_question: 'What is the monthly budget?', max_clarifying_questions: 1 },
});
const persistExpected = () => sample({
  task_type: 7,
  expected_decision_action: 'persist',
  expected_action_detail: { action: 'persist', selected_candidate: null, clarifying_question: null, max_clarifying_questions: 0, revision_type: null, persisted_decision_id: 'dec-2' },
});
const reviseExpected = () => sample({
  task_type: 6,
  expected_decision_action: 'revise',
  expected_action_detail: { action: 'revise', selected_candidate: 'a', clarifying_question: null, max_clarifying_questions: 0, revision_type: 'reverse', persisted_decision_id: 'dec-1' },
});

test('class 8: explicit and correct', () => {
  const s = scoreSample(sample(), {
    action: 'decide', selected_candidate: 'a',
    explanation: 'choose a because evidence one content', cited_evidence_ids: ['ev-1'],
  });
  assert.equal(s.taxonomyClass, 8);
});

test('class 9: explicit but arbitrary', () => {
  const s = scoreSample(sample(), {
    action: 'decide', selected_candidate: 'a',
    explanation: 'just pick a', cited_evidence_ids: [],
  });
  assert.equal(s.taxonomyClass, 9);
});

test('class 1: correct rejection', () => {
  const s = scoreSample(clarifyExpected(), { action: 'abstain', explanation: 'need budget' });
  assert.equal(s.taxonomyClass, 1);
});

test('class 2: unnecessary rejection', () => {
  const s = scoreSample(sample(), { action: 'abstain', explanation: '' });
  assert.equal(s.taxonomyClass, 2);
});

test('class 3: correct clarification', () => {
  const s = scoreSample(clarifyExpected(), { action: 'clarify', clarifying_questions: ['What is the monthly budget?'], explanation: 'need budget' });
  assert.equal(s.taxonomyClass, 3);
});

test('class 4: over-questioning', () => {
  const s = scoreSample(sample(), { action: 'clarify', clarifying_questions: ['question one', 'question two'], explanation: '' });
  assert.equal(s.taxonomyClass, 4);
});

test('class 5: correct persistence', () => {
  const s = scoreSample(persistExpected(), { action: 'persist', explanation: 'keep decision' });
  assert.equal(s.taxonomyClass, 5);
});

test('class 6: should-have-revised-but-didnt', () => {
  const s = scoreSample(reviseExpected(), { action: 'persist', explanation: 'keep old' });
  assert.equal(s.taxonomyClass, 6);
});

test('class 7: shouldnt-have-revised-but-changed', () => {
  const s = scoreSample(persistExpected(), { action: 'revise', selected_candidate: 'a', revised_decision_id: 'dec-2', explanation: 'changed my mind' });
  assert.equal(s.taxonomyClass, 7);
});
