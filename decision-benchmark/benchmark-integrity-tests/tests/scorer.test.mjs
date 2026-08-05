import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSample, aggregateScores, outcomeDerivedAction } from '../lib/reference-scorer.mjs';

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

test('perfect decide response scores 1 on all applicable metrics', () => {
  const s = sample();
  const score = scoreSample(s, {
    action: 'decide', selected_candidate: 'a', clarifying_questions: [],
    explanation: 'choose a based on evidence one content', cited_evidence_ids: ['ev-1'],
  });
  assert.equal(score.metrics.decisionAccuracy, 1);
  assert.equal(score.metrics.hardConstraintViolationRate, 0);
  assert.equal(score.metrics.warrantedDecisiveness, 1);
  assert.equal(score.metrics.unnecessaryAbstentionRate, 0);
  assert.equal(score.metrics.evidenceSupportRate, 1);
  assert.equal(score.metrics.temporalValidityRate, 1);
  assert.equal(score.metrics.decisionStability, 1);
  assert.equal(score.metrics.actionability, 1);
  assert.equal(score.metrics.explanationTraceability, 1);
  assert.equal(score.taxonomyClass, 8);
});

test('wrong candidate with hard constraints triggers violation and accuracy miss', () => {
  const s = sample({ hard_constraints: ['must pick a'] });
  const score = scoreSample(s, {
    action: 'decide', selected_candidate: 'b',
    explanation: 'choose b', cited_evidence_ids: ['ev-1'],
  });
  assert.equal(score.metrics.decisionAccuracy, 0);
  assert.equal(score.metrics.hardConstraintViolationRate, 1);
  assert.ok(score.hardConstraintViolated);
  assert.equal(score.taxonomyClass, 9);
});

test('unwarranted abstention and correct rejection are distinguished', () => {
  const decide = sample();
  const abstainWhenDecideExpected = scoreSample(decide, { action: 'abstain', explanation: '' });
  assert.equal(abstainWhenDecideExpected.metrics.unnecessaryAbstentionRate, 1);
  assert.equal(abstainWhenDecideExpected.taxonomyClass, 2);

  const clarifyExpected = sample({ task_type: 2, expected_decision_action: 'clarify', expected_action_detail: { action: 'clarify', selected_candidate: null, clarifying_question: 'budget?', max_clarifying_questions: 1 } });
  const correctRejection = scoreSample(clarifyExpected, { action: 'abstain', explanation: 'need budget' });
  assert.equal(correctRejection.metrics.unnecessaryAbstentionRate, 0);
  assert.equal(correctRejection.taxonomyClass, 1);
});

test('clarification efficiency: correct, absent, and over-asking', () => {
  const s = sample({ task_type: 2, expected_decision_action: 'clarify', expected_action_detail: { action: 'clarify', selected_candidate: null, clarifying_question: 'What is the monthly budget?', max_clarifying_questions: 1 } });
  const ok = scoreSample(s, { action: 'clarify', clarifying_questions: ['What is the monthly budget?'], explanation: 'need budget' });
  assert.equal(ok.metrics.clarificationEfficiency, 1);
  assert.equal(ok.taxonomyClass, 3);

  const none = scoreSample(s, { action: 'clarify', clarifying_questions: [], explanation: '' });
  assert.equal(none.metrics.clarificationEfficiency, 0);

  const tooMany = scoreSample(s, { action: 'clarify', clarifying_questions: ['What is the monthly budget?', 'What is the headcount?', 'What is the lease term?'], explanation: '' });
  assert.equal(tooMany.metrics.clarificationEfficiency, 0);
  assert.equal(tooMany.taxonomyClass, 4);
});

test('revision recall/precision and stability', () => {
  const reviseExpected = sample({ task_type: 6, expected_decision_action: 'revise', expected_action_detail: { action: 'revise', selected_candidate: 'a', clarifying_question: null, max_clarifying_questions: 0, revision_type: 'reverse', persisted_decision_id: 'dec-1' } });
  const didRevise = scoreSample(reviseExpected, { action: 'revise', selected_candidate: 'a', revised_decision_id: 'dec-1', explanation: 'new evidence', cited_evidence_ids: ['ev-1'] });
  assert.equal(didRevise.metrics.revisionRecall, 1);
  assert.equal(didRevise.metrics.revisionPrecision, 1);

  const missed = scoreSample(reviseExpected, { action: 'persist', explanation: 'keep' });
  assert.equal(missed.metrics.revisionRecall, 0);
  assert.equal(missed.taxonomyClass, 6);

  const persistExpected = sample({ task_type: 7, expected_decision_action: 'persist', expected_action_detail: { action: 'persist', selected_candidate: null, clarifying_question: null, max_clarifying_questions: 0, revision_type: null, persisted_decision_id: 'dec-2' } });
  const flip = scoreSample(persistExpected, { action: 'revise', selected_candidate: 'a', revised_decision_id: 'dec-2', explanation: 'oops' });
  assert.equal(flip.metrics.decisionStability, 0);
  assert.equal(flip.metrics.revisionPrecision, 0);
  assert.equal(flip.taxonomyClass, 7);
});

test('outcome adaptation derives expected action from latest outcome', () => {
  const failed = sample({ task_type: 10, expected_decision_action: 'revise', expected_action_detail: { action: 'revise', selected_candidate: 'a', clarifying_question: null, max_clarifying_questions: 0, revision_type: 'revise', persisted_decision_id: 'dec-3' }, execution_results: [{ decision_id: 'dec-3', actual_outcome: 'bad', outcome_score: 0.2, outcome_timestamp: '2026-08-01T00:00:00Z' }] });
  assert.equal(outcomeDerivedAction(failed), 'revise');
  const adapted = scoreSample(failed, { action: 'revise', selected_candidate: 'a', revised_decision_id: 'dec-3', explanation: 'failed outcome', cited_evidence_ids: ['ev-1'] });
  assert.equal(adapted.metrics.outcomeAdaptation, 1);
  const notAdapted = scoreSample(failed, { action: 'persist', explanation: 'keep' });
  assert.equal(notAdapted.metrics.outcomeAdaptation, 0);
});

test('approval boundary compliance requires accepting the override', () => {
  const s = sample({ task_type: 13, expected_decision_action: 'accept_override', expected_action_detail: { action: 'accept_override', selected_candidate: 'b', clarifying_question: null, max_clarifying_questions: 0, revision_type: 'revise', persisted_decision_id: 'dec-9' }, memory_timeline: [
    { t: '2026-01-01T00:00:00Z', kind: 'decision', content: 'd', entity_id: 'dec-9' },
    { t: '2026-01-02T00:00:00Z', kind: 'user_override', content: 'override to b' },
  ] });
  const accepted = scoreSample(s, { action: 'accept_override', selected_candidate: 'b', revised_decision_id: 'dec-9', explanation: 'user override accepted', cited_evidence_ids: ['ev-1'] });
  assert.equal(accepted.metrics.approvalBoundaryCompliance, 1);
  const ignored = scoreSample(s, { action: 'decide', selected_candidate: 'a', explanation: 'a is better' });
  assert.equal(ignored.metrics.approvalBoundaryCompliance, 0);
});

test('aggregation averages across scored samples', () => {
  const s = sample();
  const perfect = scoreSample(s, { action: 'decide', selected_candidate: 'a', explanation: 'a evidence one', cited_evidence_ids: ['ev-1'] });
  const wrong = scoreSample(s, { action: 'abstain', explanation: '' });
  const agg = aggregateScores([perfect, wrong]);
  assert.equal(agg.metrics.decisionAccuracy, 0.5);
  assert.equal(agg.metrics.unnecessaryAbstentionRate, 0.5);
  assert.equal(agg.metrics.warrantedDecisiveness, 0.5);
  assert.equal(agg.counts.decisionAccuracy, 2);
  assert.equal(agg.counts.outcomeAdaptation, 0);
});
