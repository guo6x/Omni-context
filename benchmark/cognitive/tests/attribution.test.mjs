import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareScore, deriveSourceGoldAudit, normalize, normalizeAttributionProtocol, phraseMatches, selectCompletedRecords, validateAttributionModelReview, validateAttributionReview } from '../src/attribution-v1.1.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EVIDENCE = path.join(ROOT, 'docs', 'cognitive-benchmark-v1.1-review', 'evidence');
const REPAIRED_EVIDENCE = path.join(ROOT, 'docs', 'cognitive-benchmark-v1.1-review', 'attribution-v1.1.1', 'evidence');
const jsonl = async (file) => (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);

function validReview() {
  return {
    scenario_id: 'scenario-1', mode: 'full_omni', original_gold_valid: true, gold_support_confidence: 1,
    primary_attribution: 'retrieval_failure', secondary_attributions: ['product_limitation'], first_loss_stage: 'final_context',
    score_is_valid: true, score_should_change: false, suggested_score_change: null,
    benchmark_validity_impact: 'local', confidence: 0.9,
    evidence: [{ claim: 'Gold is present in the source event.', supporting_ids: ['event-1'] }], notes: 'A concise attribution.',
  };
}

function validComparedReview() {
  return { ...validReview(), old_review_was_correct: false, old_review_error_types: ['confused_missing_context_with_gold'], old_review_comparable: true };
}

test('normalization and semantic phrase matching preserve structured values', () => {
  assert.equal(normalize('April 18'), 'april 18');
  assert.equal(phraseMatches('The current deadline is April 18.', 'April 18'), true);
  assert.equal(phraseMatches('completely unrelated', 'April 18'), false);
});

test('model Attribution schema excludes locally derived old-review comparison fields', () => {
  assert.deepEqual(validateAttributionModelReview(validReview(), { scenario_id: 'scenario-1', mode: 'full_omni' }), validReview());
  assert.throws(() => validateAttributionModelReview(validComparedReview()), /keys do not match/);
  assert.deepEqual(validateAttributionReview(validComparedReview(), { scenario_id: 'scenario-1', mode: 'full_omni' }), validComparedReview());
});

test('strict Attribution Review schema rejects extra keys and invalid score changes', () => {
  assert.throws(() => validateAttributionModelReview({ ...validReview(), extra: true }), /keys do not match/);
  assert.throws(() => validateAttributionModelReview({ ...validReview(), score_should_change: true, suggested_score_change: 0.5 }), /requires scoring_defect/);
});

test('strict Attribution Review schema enforces evidence and notes limits', () => {
  assert.throws(() => validateAttributionModelReview({ ...validReview(), evidence: Array.from({ length: 7 }, () => ({ claim: 'x', supporting_ids: [] })) }), /at most 6/);
  assert.throws(() => validateAttributionModelReview({ ...validReview(), notes: 'x'.repeat(501) }), /at most 500/);
});

test('Attribution adapter normalizes only documented unambiguous forms', () => {
  const protocol = normalizeAttributionProtocol({ ...validReview(), original_gold_valid: 'true', score_is_valid: 'true', score_should_change: 'false', first_loss_stage: 'final visible context', benchmark_validity_impact: 'no impact' });
  assert.equal(protocol.normalized.original_gold_valid, true);
  assert.equal(protocol.normalized.score_should_change, false);
  assert.equal(protocol.normalized.first_loss_stage, 'final_context');
  assert.equal(protocol.normalized.benchmark_validity_impact, 'none');
  assert.ok(protocol.changes.length >= 5);
  assert.throws(() => validateAttributionModelReview({ ...validReview(), first_loss_stage: 'somewhere around retrieval' }), /first_loss_stage invalid/);
});

test('completed result selection excludes retries and errors', () => {
  const rows = [{ scenario_id: 'a', mode: 'retrieval_only', status: 'retry' }, { scenario_id: 'a', mode: 'retrieval_only', status: 'completed', value: 1 }, { scenario_id: 'a', mode: 'retrieval_only', status: 'completed', value: 2 }];
  assert.deepEqual(selectCompletedRecords(rows), [rows[2]]);
});

test('all 35 Development Gold records are supported by original events, with field/text defects separated', async () => {
  const [scenarios, results] = await Promise.all([jsonl(path.join(EVIDENCE, 'development-dataset-v2.jsonl')), jsonl(path.join(EVIDENCE, 'development-full-omni-results-v2.1.jsonl'))]);
  const byId = new Map(selectCompletedRecords(results).map((row) => [row.scenario_id, row]));
  assert.equal(scenarios.length, 35);
  const audits = scenarios.map((scenario) => deriveSourceGoldAudit(scenario, byId.get(scenario.scenario_id)));
  for (const audit of audits) assert.equal(audit.gold_supported_by_original_events, true, audit.scenario_id);
  // detectAgentFieldTextMismatches returns [] for all scenarios — the regenerated dataset
  // has matching agent text/field pairs. No dataset_defect is expected for any category.
  assert.deepEqual(audits.filter((audit) => audit.dataset_defect).map((audit) => audit.scenario_id), []);
});

test('Deterministic Scoring v3 executes for all 35 archived rows; baseline invalidation is detected after Gold/scoring fix', async () => {
  const [scenarios, results] = await Promise.all([jsonl(path.join(EVIDENCE, 'development-dataset-v2.jsonl')), jsonl(path.join(EVIDENCE, 'development-full-omni-results-v2.1.jsonl'))]);
  const byId = new Map(scenarios.map((row) => [row.scenario_id, row]));
  const completed = selectCompletedRecords(results);
  assert.equal(completed.length, 35);
  // Scoring must execute deterministically for all 35 rows (no exceptions, no NaN).
  const invalidatedCategories = new Set();
  for (const result of completed) {
    const scenario = byId.get(result.scenario_id);
    const comparison = compareScore(result, scenario);
    assert.ok(Number.isFinite(comparison.recomputed_core_score), `${result.scenario_id} core score must be finite`);
    if (!comparison.exact_within_1e_9) invalidatedCategories.add(scenario.category);
  }
  // Baseline invalidation: phrasePresent ordered-matching fix affects coverage() used by
  // all categories; memory_evolution Gold generation also changed. At least memory_evolution
  // must be invalidated, confirming the baseline cannot be used as same-config reference.
  assert.ok(invalidatedCategories.has('memory_evolution'), 'memory_evolution baseline must be invalidated');
  assert.ok(invalidatedCategories.size > 0, 'baseline invalidation must be detected');
});

test('v2.1.1 evidence changes only Cross-Agent scenarios and passes Formal invariants', async () => {
  const [diff, audit] = await Promise.all([
    readFile(path.join(REPAIRED_EVIDENCE, 'dataset-scenario-diff.json'), 'utf8').then(JSON.parse),
    readFile(path.join(REPAIRED_EVIDENCE, 'cross-agent-invariant-audit.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(diff.status, 'pass');
  assert.equal(diff.changed_scenarios, 38);
  assert.equal(diff.changed_non_cross_agent_scenarios, 0);
  assert.equal(diff.non_cross_agent_hash_consistent, true);
  assert.equal(audit.status, 'pass');
  assert.equal(audit.mismatches, 0);
  assert.equal(audit.formal_count, 30);
  assert.equal(audit.formal_dataset_defects, 0);
});

test('v1.1.1 final Attribution Review is complete, locally compared, and P0-free', async () => {
  const [review, comparison, validity, recommendation] = await Promise.all([
    readFile(path.join(REPAIRED_EVIDENCE, 'secondary-attribution-review.json'), 'utf8').then(JSON.parse),
    readFile(path.join(REPAIRED_EVIDENCE, 'secondary-review-comparison.json'), 'utf8').then(JSON.parse),
    readFile(path.join(REPAIRED_EVIDENCE, 'benchmark-validity-assessment.json'), 'utf8').then(JSON.parse),
    readFile(path.join(REPAIRED_EVIDENCE, 'formal-freeze-recommendation.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(review.count, 20);
  assert.equal(review.status, 'completed');
  assert.equal(comparison.old_review_comparable_count + comparison.old_review_non_comparable_count, 20);
  for (const row of review.reviews) validateAttributionReview(row.attribution_review, row);
  assert.equal(validity.dataset_defects, 0);
  assert.equal(validity.scoring_defects, 0);
  assert.deepEqual(validity.unresolved_p0, []);
  assert.equal(recommendation.status, 'COGNITIVE BENCHMARK V1.1 ATTRIBUTION REVIEW PASSED');
  assert.equal(recommendation.passed, true);
});
