import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSplit } from '../src/scenarios.mjs';
import { syntheticOracleAnswer } from '../src/provider.mjs';
import { aggregateResults, scoreScenario } from '../src/scoring.mjs';

const blank = () => ({ answer: 'No supported fact.', facts: [], transitions: [], constraints_used: [], rejected_facts: [], insights: [], actions: [], uncertainty: null });
const evolution = () => ({ category: 'memory_evolution', gold: { required_facts: ['new', 'old'], current_facts: ['new'], historical_facts: ['old'], stale_as_current: ['old'], transitions: [{ key: 'status', from_value: 'old', to_value: 'new' }] } });
const fact = (value, state, id = 'e1', agents = []) => ({ key: 'status', value, state, source_ids: [id], source_agents: agents });

test('rejected fact and actions/insights cannot obtain required positive coverage', () => {
  const scenario = { category: 'cognitive_continuity', gold: { required_facts: ['gold target'], required_constraints: [], forbidden_facts: [] } };
  const answer = blank();
  answer.rejected_facts = [{ value: 'gold target', reason: 'unsupported', source_ids: ['e1'] }];
  answer.insights = ['gold target']; answer.actions = ['gold target'];
  const score = scoreScenario({ scenario, answer, visibleSourceIds: ['e1'] });
  assert.equal(score.metrics.profile_recall, 0);
});

test('historical fact cannot obtain current score and current fact cannot obtain historical score', () => {
  const historicalOnly = blank(); historicalOnly.facts = [fact('new', 'historical')];
  const currentOnly = blank(); currentOnly.facts = [fact('old', 'current')];
  assert.equal(scoreScenario({ scenario: evolution(), answer: historicalOnly, visibleSourceIds: ['e1'] }).metrics.current_state_accuracy, 0);
  assert.equal(scoreScenario({ scenario: evolution(), answer: currentOnly, visibleSourceIds: ['e1'] }).metrics.historical_state_preservation, 0);
});

test('reversed transition and missing transition receive no Temporal Ordering credit', () => {
  const reversed = blank(); reversed.facts = [fact('new', 'current'), fact('old', 'historical', 'e2')]; reversed.transitions = [{ key: 'status', from_value: 'new', to_value: 'old', source_ids: ['e1', 'e2'] }];
  const missing = structuredClone(reversed); missing.transitions = [];
  assert.equal(scoreScenario({ scenario: evolution(), answer: reversed, visibleSourceIds: ['e1', 'e2'] }).metrics.temporal_ordering_accuracy, 0);
  assert.equal(scoreScenario({ scenario: evolution(), answer: missing, visibleSourceIds: ['e1', 'e2'] }).metrics.temporal_ordering_accuracy, 0);
});

test('an omitted stale fact is not leakage, but treating it as current is leakage', () => {
  const omitted = blank(); omitted.facts = [fact('new', 'current')];
  const current = structuredClone(omitted); current.facts.push(fact('old', 'current', 'e2'));
  assert.equal(scoreScenario({ scenario: evolution(), answer: omitted, visibleSourceIds: ['e1'] }).metrics.stale_memory_leakage, 0);
  assert.equal(scoreScenario({ scenario: evolution(), answer: current, visibleSourceIds: ['e1', 'e2'] }).metrics.stale_memory_leakage, 1);
});

test('invalidated fact counts as rejected only through structured rejected_facts', () => {
  const scenario = { category: 'conflict_resolution', gold: { required_facts: ['new', 'old'], current_facts: ['new'], historical_facts: ['old'], invalidated_facts: ['bad'], conflict_disclosure: [], forbidden_facts: [] } };
  const mention = blank(); mention.answer = 'bad is invalid'; mention.facts = [fact('new', 'current'), fact('old', 'historical', 'e2')];
  const rejected = structuredClone(mention); rejected.rejected_facts = [{ value: 'bad', reason: 'invalidated', source_ids: ['e3'] }];
  assert.equal(scoreScenario({ scenario, answer: mention, visibleSourceIds: ['e1', 'e2', 'e3'] }).metrics.invalidated_fact_rejection, 0);
  assert.equal(scoreScenario({ scenario, answer: rejected, visibleSourceIds: ['e1', 'e2', 'e3'] }).metrics.invalidated_fact_rejection, 1);
});

test('invalid source ID increases Unsupported Rate', () => {
  const scenario = { category: 'cognitive_continuity', gold: { required_facts: [], required_constraints: [], forbidden_facts: [] } };
  const answer = blank(); answer.facts = [fact('supported', 'supported', 'hidden')];
  assert.equal(scoreScenario({ scenario, answer, visibleSourceIds: ['visible'] }).metrics.unsupported_personalization_rate, 1);
});

test('invented Agent receives no Cross-Agent Provenance credit', () => {
  const scenario = { category: 'cross_agent_transfer', gold: { required_facts: ['goal'], current_facts: [], required_sources: ['Agent-A'], forbidden_facts: [] } };
  const answer = blank(); answer.facts = [{ key: 'goal', value: 'goal', state: 'supported', source_ids: ['e1'], source_agents: ['Agent-X'] }];
  assert.equal(scoreScenario({ scenario, answer, visibleSourceIds: ['e1'], visibleAgents: ['Agent-A'] }).metrics.provenance_preservation, 0);
});

test('not-implemented forgetting capabilities remain null/excluded instead of numeric zero', () => {
  const scenario = generateSplit('smoke').find((item) => item.category === 'human_like_forgetting');
  const answer = syntheticOracleAnswer(scenario);
  const score = scoreScenario({ scenario, answer, visibleSourceIds: scenario.events.map((event) => event.id), visibleAgents: scenario.events.map((event) => event.agent) });
  assert.equal(score.metrics.memory_compression_ratio, null);
  assert.equal(score.forgetting_capabilities.physical_deletion, 'not_implemented');
  assert.equal(score.forgetting_capabilities.memory_compression, 'not_implemented');
});

test('scores seven categories, includes Judge redundancy, and macro-averages categories equally', () => {
  const scenarios = generateSplit('smoke');
  const records = scenarios.map((scenario) => {
    const judge = ['proactive_insight', 'decision_quality'].includes(scenario.category) ? { rubric_scores: { insight_precision: 1, insight_recall: 1, blind_spot_detection: 1, constraint_awareness: 1, actionability: 1, goal_alignment: 1, option_comparison: 1, risk_awareness: 1, internal_consistency: 1, overall_quality: 1 }, unsupported_claim_rate: 0, overreach_rate: 0, redundant_insight_rate: 0 } : null;
    return { status: 'completed', category: scenario.category, score: scoreScenario({ scenario, answer: syntheticOracleAnswer(scenario), visibleSourceIds: scenario.events.map((event) => event.id), visibleAgents: scenario.events.map((event) => event.agent), judge }) };
  });
  const metrics = aggregateResults(records);
  assert.equal(Object.keys(metrics.by_category).length, 7);
  assert.equal(metrics.completed, 21);
  assert.equal(metrics.by_category.proactive_insight.metrics.redundant_insight_rate, 0);
});
