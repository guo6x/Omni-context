import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  buildInterleavedPlan,
  CONDITION_TO_ENV,
  STRICT_ABLATION_CONDITIONS,
} from '../research/strict-ablation-plan.mjs';
import { budgetSnapshot } from '../research/strict-ablation-runner.mjs';
import { bootstrapMeanDifference, pairedSummary, wilcoxonSignedRank } from '../research/paired-statistics.mjs';

const scenarios = Array.from({ length: 5 }, (_, index) => ({ scenario_id: `fixture-${index + 1}`, category: 'fixture' }));

test('strict ablation order is deterministic and interleaved by scenario', () => {
  const first = buildInterleavedPlan(scenarios, 20260717);
  const second = buildInterleavedPlan(scenarios, 20260717);
  assert.deepEqual(first, second);
  assert.equal(first.length, scenarios.length * 4);
  for (const scenario of scenarios) {
    const conditions = first.filter((entry) => entry.scenario_id === scenario.scenario_id).map((entry) => entry.condition).sort();
    assert.deepEqual(conditions, [...STRICT_ABLATION_CONDITIONS].sort());
  }
});

test('strict ablation plan maps only to the four declared research conditions', () => {
  assert.deepEqual(Object.keys(CONDITION_TO_ENV).sort(), [...STRICT_ABLATION_CONDITIONS].sort());
  assert.equal(CONDITION_TO_ENV.full_omni_fresh_control, 'none');
});

test('bootstrap is deterministic at 10,000 iterations', () => {
  const first = bootstrapMeanDifference([0.1, 0.2, -0.1, 0.4], { iterations: 10_000, seed: 7 });
  const second = bootstrapMeanDifference([0.1, 0.2, -0.1, 0.4], { iterations: 10_000, seed: 7 });
  assert.deepEqual(first, second);
  assert.ok(first.lower <= first.upper);
});

test('paired summary reports direction, Wilcoxon, and effect size', () => {
  const full = new Map([['a', 0.9], ['b', 0.8], ['c', 0.7], ['d', 0.5]]);
  const ablated = new Map([['a', 0.7], ['b', 0.8], ['c', 0.6], ['d', 0.6]]);
  const summary = pairedSummary(full, ablated, { iterations: 10_000, seed: 11 });
  assert.equal(summary.paired_n, 4);
  assert.equal(summary.full_higher, 2);
  assert.equal(summary.ablation_higher, 1);
  assert.equal(summary.ties, 1);
  assert.ok(Number.isFinite(summary.wilcoxon.p_two_sided));
  assert.ok(Number.isFinite(summary.effect_size.paired_cohens_dz));
});

test('Wilcoxon handles all ties without claiming significance', () => {
  assert.deepEqual(wilcoxonSignedRank([0, 0, 0]), {
    n: 0,
    w_plus: 0,
    w_minus: 0,
    z: 0,
    p_two_sided: 1,
    rank_biserial: 0,
  });
});

test('strict ablation call budget includes retained prior-run consumption', async () => {
  const base = 'D:\\OmniContext-research-runs\\ablation\\test-temp';
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'omni-ablation-budget-'));
  try {
    const scenarios = Array.from({ length: 35 }, (_, index) => ({ scenario_id: `s-${index}`, state_transition_count: 0, category: 'cognitive_continuity' }));
    const budget = await budgetSnapshot(root, scenarios, { deepseekKnown: 742, kimiPhysical: 0 });
    assert.equal(budget.global_observed.deepseek_known, 742);
    assert.equal(budget.exceeded, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
