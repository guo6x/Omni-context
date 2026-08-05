import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadFixtures } from '../lib/validate-sample.mjs';
import { normalize } from '../lib/reference-scorer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function allEntityIds(sample) {
  const ids = new Set();
  for (const e of [...(sample.valid_evidence || []), ...(sample.expired_evidence || []), ...(sample.conflicting_evidence || [])]) {
    if (e.entity_id) ids.add(e.entity_id);
  }
  for (const ev of sample.memory_timeline || []) {
    if (ev.entity_id) ids.add(ev.entity_id);
  }
  return ids;
}

function allDecisionIds(sample) {
  const ids = new Set();
  for (const d of sample.historical_decisions || []) ids.add(d.decision_id);
  for (const o of sample.execution_results || []) ids.add(o.decision_id);
  return ids;
}

function ngrams(text, n = 8) {
  const clean = normalize(text);
  const grams = new Set();
  for (let i = 0; i + n <= clean.length; i++) grams.add(clean.slice(i, i + n));
  return grams;
}

test('development and regression pools are disjoint (ids, entities, decisions, narratives)', () => {
  const dev = loadFixtures(path.join(root, 'development-fixtures.jsonl'));
  const reg = loadFixtures(path.join(root, 'regression-fixtures.jsonl'));

  const devIds = new Set(dev.map((s) => s.sample_id));
  const regIds = new Set(reg.map((s) => s.sample_id));
  assert.equal([...devIds].filter((id) => regIds.has(id)).length, 0, 'sample ids overlap');

  const devEntities = new Set(dev.flatMap((s) => [...allEntityIds(s)]));
  const regEntities = new Set(reg.flatMap((s) => [...allEntityIds(s)]));
  const entityOverlap = [...devEntities].filter((id) => regEntities.has(id));
  assert.deepEqual(entityOverlap, [], 'entity ids overlap between pools');

  const devDecisions = new Set(dev.flatMap((s) => [...allDecisionIds(s)]));
  const regDecisions = new Set(reg.flatMap((s) => [...allDecisionIds(s)]));
  const decisionOverlap = [...devDecisions].filter((id) => regDecisions.has(id));
  assert.deepEqual(decisionOverlap, [], 'decision ids overlap between pools');

  // 8-gram guard: no narrative pair may share >= 3 eight-grams.
  let worst = 0;
  let worstPair = null;
  for (const d of dev) {
    const dGrams = ngrams(d.narrative);
    for (const r of reg) {
      const rGrams = ngrams(r.narrative);
      let shared = 0;
      for (const g of dGrams) if (rGrams.has(g)) shared++;
      if (shared > worst) { worst = shared; worstPair = [d.sample_id, r.sample_id]; }
    }
  }
  assert.ok(worst < 3, `narrative 8-gram overlap too high: ${worst} (${worstPair?.join(' vs ')})`);
});
