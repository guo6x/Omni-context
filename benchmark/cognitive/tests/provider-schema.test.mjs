import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceSourceAgents, validateAgentReview } from '../src/provider.mjs';
import { validateAnswerV2, validateKimiJudgeV2 } from '../src/schemas.mjs';

const answer = () => ({
  answer: 'Current value is new; old was historical.',
  facts: [
    { key: 'status', value: 'new', state: 'current', source_ids: ['e2'], source_agents: ['Agent-B'] },
    { key: 'status', value: 'old', state: 'historical', source_ids: ['e1'], source_agents: ['Agent-A'] },
  ],
  transitions: [{ key: 'status', from_value: 'old', to_value: 'new', source_ids: ['e1', 'e2'] }],
  constraints_used: [],
  rejected_facts: [{ value: 'bad', reason: 'low_confidence', source_ids: ['e3'] }],
  insights: [], actions: [], uncertainty: null,
});

test('validates answer-schema-v2 exact states, sources, Agents, transitions, and rejection reasons', () => {
  assert.doesNotThrow(() => validateAnswerV2(answer(), { visibleSourceIds: ['e1', 'e2', 'e3'], visibleAgents: ['Agent-A', 'Agent-B'] }));
  const badId = answer(); badId.facts[0].source_ids = ['hidden'];
  assert.throws(() => validateAnswerV2(badId, { visibleSourceIds: ['e1', 'e2', 'e3'], visibleAgents: ['Agent-A', 'Agent-B'] }), /invisible source ID/);
  const badAgent = answer(); badAgent.facts[0].source_agents = ['Agent-X'];
  assert.throws(() => validateAnswerV2(badAgent, { visibleSourceIds: ['e1', 'e2', 'e3'], visibleAgents: ['Agent-A', 'Agent-B'] }), /invisible Agent/);
  const collision = answer(); collision.rejected_facts[0].value = 'new';
  assert.throws(() => validateAnswerV2(collision, { visibleSourceIds: ['e1', 'e2', 'e3'], visibleAgents: ['Agent-A', 'Agent-B'] }), /cannot also be current/);
});

test('allows No Memory question-supported facts only with empty sources and no Agent', () => {
  const value = answer();
  value.facts = [{ key: 'question premise', value: 'Option A exists', state: 'supported', source_ids: [], source_agents: [] }];
  value.transitions = []; value.rejected_facts = [];
  assert.doesNotThrow(() => validateAnswerV2(value, { allowEmptySources: true }));
  value.facts[0].source_agents = ['Agent-A'];
  assert.throws(() => validateAnswerV2(value, { allowEmptySources: true }), /invent source Agent/);
});

test('validates Kimi Judge v2 schema including redundancy and diagnostic arrays', () => {
  const rubric = Object.fromEntries(['insight_precision', 'insight_recall', 'blind_spot_detection', 'constraint_awareness', 'actionability', 'goal_alignment', 'option_comparison', 'risk_awareness', 'internal_consistency', 'overall_quality'].map((key) => [key, 0.5]));
  assert.doesNotThrow(() => validateKimiJudgeV2({ rubric_scores: rubric, unsupported_claim_rate: 0, overreach_rate: 0, redundant_insight_rate: 0.25, missing_required_elements: [], unsupported_elements: [], rationale: 'calibrated' }));
  assert.throws(() => validateKimiJudgeV2({ rubric_scores: rubric, unsupported_claim_rate: 0, overreach_rate: 0, redundant_insight_rate: 2, missing_required_elements: [], unsupported_elements: [], rationale: 'bad' }), /negative metric/);
  assert.throws(() => validateKimiJudgeV2({ rubric_scores: rubric, unsupported_claim_rate: 0, overreach_rate: 0, redundant_insight_rate: 0, missing_required_elements: Array(6).fill('x'), unsupported_elements: [], rationale: 'bad' }), /at most 5/);
  assert.throws(() => validateKimiJudgeV2({ rubric_scores: rubric, unsupported_claim_rate: 0, overreach_rate: 0, redundant_insight_rate: 0, missing_required_elements: [], unsupported_elements: [], rationale: 'x'.repeat(241) }), /at most 240/);
});

test('validates Secondary Agent Review as non-human evidence', () => {
  assert.doesNotThrow(() => validateAgentReview({ scenario_id: 'd-1', verdict: 'agree', score_issue: false, gold_ambiguity: false, baseline_fairness_issue: false, memory_leakage_issue: false, judge_reliability_issue: false, provenance_issue: false, invalidated_fact_rejection_issue: false, temporal_transition_issue: false, notes: 'No issue.' }));
  assert.throws(() => validateAgentReview({ scenario_id: 'd-1', verdict: 'human approved' }), /keys/);
});

test('recovers only visible speaker and Agent labels from evidence passages', () => {
  const agents = evidenceSourceAgents(
    { source_agents: ['Agent-A'], provenance: { agent: 'Agent-B' } },
    'Fact text\nSpeaker: Gray\nSource: Agent-C confirmed the update.',
  );
  assert.deepEqual(agents.sort(), ['Agent-A', 'Agent-B', 'Agent-C', 'Gray']);
  assert.deepEqual(evidenceSourceAgents({}, 'Fact text\nSpeaker: not provided'), []);
});
