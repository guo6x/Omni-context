import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRetrievalPreflight } from '../src/retrieval-preflight.mjs';

const scenario = {
  scenario_id: 'fixture-decision',
  category: 'decision_quality',
  events: [
    { agent: 'Agent-A', state_key: 'option_a', value: 'Option A' },
    { agent: 'Agent-B', state_key: 'option_b', value: 'Option B' },
    { agent: 'Agent-A', state_key: 'constraint', value: '611 dollars; stable income' },
  ],
  gold: {
    required_facts: ['Option A', 'Option B', '611 dollars', 'stable income'],
    required_constraints: ['611 dollars', 'stable income'],
    required_option_comparison: ['Option A', 'Option B'],
  },
};

describe('retrieval-only gate evaluation', () => {
  it('accepts a selector-attested Top-10 with complete slots and real Agents', () => {
    const items = [
      evidence('a', 'Option A offers stability.', ['Agent-A'], ['option_a']),
      evidence('b', 'Option B offers autonomy.', ['Agent-B'], ['option_b']),
      evidence('c', 'Budget is 611 dollars and stable income is required.', ['Agent-A'], ['constraint']),
    ];
    const result = evaluateRetrievalPreflight(scenario, {
      candidatePool: items,
      finalContext: items.map((item, index) => ({ ...item, selected_for_answer: true, final_rank: index + 1 })),
      fusionConfig: { evidence_selector_version: 'evidence-selector-v2' },
      trace: { status: 'written', trace_id: 'trace-1' },
    }, {
      productCommit: '2e300acad083626285ff43b650717e66a04671dd',
      expectedProductCommit: '2e300acad083626285ff43b650717e66a04671dd',
      expectedSelectorVersion: 'evidence-selector-v2',
    });

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.slot_coverage.top10.ratio, 1);
    assert.deepStrictEqual(result.invalid_source_agents, []);
    assert.strictEqual(result.selector_executed, true);
  });

  it('rejects selector bypass, support-only context, and entity values masquerading as Agents', () => {
    const item = evidence('s', 'Jordan confirms support note 4-8.', ['Jordan'], ['support_7']);
    const result = evaluateRetrievalPreflight(scenario, {
      candidatePool: [item],
      finalContext: [{ ...item, selected_for_answer: true }],
      fusionConfig: {},
      trace: { status: 'disabled' },
    }, {
      productCommit: '0'.repeat(40),
      expectedProductCommit: '2e300acad083626285ff43b650717e66a04671dd',
      expectedSelectorVersion: 'evidence-selector-v2',
    });

    assert.strictEqual(result.passed, false);
    assert.deepStrictEqual(result.invalid_source_agents, ['Jordan']);
    assert.strictEqual(result.top10_support_or_relation_only, true);
    assert.strictEqual(result.selector_executed, false);
    assert.strictEqual(result.service_commit_verified, false);
  });
});

function evidence(id, passage, sourceAgents, stateKeys) {
  return { id, evidence_id: id, passage, source_agents: sourceAgents, state_keys: stateKeys };
}
