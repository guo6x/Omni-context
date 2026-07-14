import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSplit } from '../src/scenarios.mjs';
import { syntheticOracleAnswer } from '../src/provider.mjs';
import { aggregateResults, scoreScenario } from '../src/scoring.mjs';

test('scores all seven categories and macro-averages categories equally', () => {
  const scenarios = generateSplit('smoke');
  const records = scenarios.map((scenario) => {
    const answer = syntheticOracleAnswer(scenario);
    const judge = ['proactive_insight', 'decision_quality'].includes(scenario.category) ? {
      rubric_scores: { insight_precision: 1, insight_recall: 1, blind_spot_detection: 1, constraint_awareness: 1, actionability: 1, goal_alignment: 1, option_comparison: 1, risk_awareness: 1, internal_consistency: 1, overall_quality: 1 },
      unsupported_claim_rate: 0,
      overreach_rate: 0,
    } : null;
    return { status: 'completed', category: scenario.category, score: scoreScenario({ scenario, answer, visibleSourceIds: scenario.events.map((e) => e.id), judge }) };
  });
  const metrics = aggregateResults(records);
  assert.equal(Object.keys(metrics.by_category).length, 7);
  assert.equal(metrics.completed, 21);
  assert.ok(metrics.overall_cognitive_score > 0.7);
});

test('does not include not-implemented forgetting capabilities as numeric zeroes', () => {
  const scenario = generateSplit('smoke').find((s) => s.category === 'human_like_forgetting');
  const score = scoreScenario({ scenario, answer: syntheticOracleAnswer(scenario), visibleSourceIds: scenario.events.map((e) => e.id) });
  assert.equal(score.metrics.memory_compression_ratio, null);
  assert.equal(score.forgetting_capabilities.physical_deletion, 'not_implemented');
  assert.equal(score.forgetting_capabilities.memory_compression, 'not_implemented');
});

test('does not count explicitly rejected or negated evidence as an affirmed forbidden fact', () => {
  const scenario = generateSplit('development').find((row) => row.category === 'human_like_forgetting');
  const answer = {
    answer: 'Keep the long-term goal. The headache is resolved and the drone plan is invalidated.',
    facts: [
      { key: 'goal', value: scenario.gold.required_facts[0], source_ids: ['e1'] },
      { key: 'resolved headache', value: 'headache is resolved', source_ids: ['e2'] },
      { key: 'invalidated plan', value: 'buy a drone is invalidated', source_ids: ['e3'] },
    ],
    constraints_used: [],
    rejected_facts: ['headache', 'buy a drone', 'blue button'],
    insights: [], actions: [], uncertainty: null,
  };
  const score = scoreScenario({ scenario, answer, visibleSourceIds: ['e1', 'e2', 'e3'] });
  assert.equal(score.metrics.noise_suppression, 1);
  assert.equal(score.metrics.stale_retention_rate, 0);
});
