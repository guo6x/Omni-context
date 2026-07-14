import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareScore, deriveSourceGoldAudit, normalize, phraseMatches, selectCompletedRecords, validateAttributionReview } from '../src/attribution-v1.1.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EVIDENCE = path.join(ROOT, 'docs', 'cognitive-benchmark-v1.1-review', 'evidence');
const jsonl = async (file) => (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse);

function validReview() {
  return {
    scenario_id: 'scenario-1', mode: 'full_omni', original_gold_valid: true, gold_support_confidence: 1,
    primary_attribution: 'retrieval_failure', secondary_attributions: ['product_limitation'], first_loss_stage: 'final_context',
    score_is_valid: true, score_should_change: false, suggested_score_change: null,
    old_review_was_correct: false, old_review_error_types: ['confused_missing_context_with_gold'], benchmark_validity_impact: 'local', confidence: 0.9,
    evidence: [{ claim: 'Gold is present in the source event.', supporting_ids: ['event-1'] }], notes: 'A concise attribution.',
  };
}

test('normalization and semantic phrase matching preserve structured values', () => {
  assert.equal(normalize('April 18'), 'april 18');
  assert.equal(phraseMatches('The current deadline is April 18.', 'April 18'), true);
  assert.equal(phraseMatches('completely unrelated', 'April 18'), false);
});

test('strict Attribution Review schema accepts a valid object', () => {
  assert.deepEqual(validateAttributionReview(validReview(), { scenario_id: 'scenario-1', mode: 'full_omni' }), validReview());
});

test('strict Attribution Review schema rejects extra keys and invalid score changes', () => {
  assert.throws(() => validateAttributionReview({ ...validReview(), extra: true }), /keys do not match/);
  assert.throws(() => validateAttributionReview({ ...validReview(), score_should_change: true, suggested_score_change: 0.5 }), /requires scoring_defect/);
});

test('strict Attribution Review schema enforces evidence and notes limits', () => {
  assert.throws(() => validateAttributionReview({ ...validReview(), evidence: Array.from({ length: 7 }, () => ({ claim: 'x', supporting_ids: [] })) }), /at most 6/);
  assert.throws(() => validateAttributionReview({ ...validReview(), notes: 'x'.repeat(501) }), /at most 500/);
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
  assert.deepEqual(audits.filter((audit) => audit.dataset_defect).map((audit) => audit.scenario_id), scenarios.filter((scenario) => scenario.category === 'cross_agent_transfer').map((scenario) => scenario.scenario_id));
});

test('Deterministic Scoring v3 recomputes exactly for all 35 archived Full Omni rows', async () => {
  const [scenarios, results] = await Promise.all([jsonl(path.join(EVIDENCE, 'development-dataset-v2.jsonl')), jsonl(path.join(EVIDENCE, 'development-full-omni-results-v2.1.jsonl'))]);
  const byId = new Map(scenarios.map((row) => [row.scenario_id, row]));
  const completed = selectCompletedRecords(results);
  assert.equal(completed.length, 35);
  for (const result of completed) assert.equal(compareScore(result, byId.get(result.scenario_id)).exact_within_1e_9, true, result.scenario_id);
});
