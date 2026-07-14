import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAgentReview, validateAnswer, validateJudge } from '../src/provider.mjs';

test('validates the exact Answer and Judge schemas', () => {
  assert.doesNotThrow(() => validateAnswer({ answer: 'ok', facts: [{ key: 'k', value: 'v', source_ids: ['e1'] }], constraints_used: [], rejected_facts: [], insights: [], actions: [], uncertainty: null }));
  assert.doesNotThrow(() => validateJudge({
    rubric_scores: Object.fromEntries(['insight_precision', 'insight_recall', 'blind_spot_detection', 'constraint_awareness', 'actionability', 'goal_alignment', 'option_comparison', 'risk_awareness', 'internal_consistency', 'overall_quality'].map((key) => [key, 0.5])),
    unsupported_claim_rate: 0,
    overreach_rate: 0,
    rationale: 'calibrated',
  }));
  assert.throws(() => validateAnswer({ answer: 'missing fields' }), /keys/);
});

test('validates Agent Review as non-human structured evidence', () => {
  assert.doesNotThrow(() => validateAgentReview({ scenario_id: 'd-1', verdict: 'agree', score_issue: false, gold_ambiguity: false, baseline_fairness_issue: false, memory_leakage_issue: false, notes: 'No issue.' }));
  assert.throws(() => validateAgentReview({ scenario_id: 'd-1', verdict: 'human approved' }), /keys/);
});
