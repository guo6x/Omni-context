import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadFixtures, TASK_TYPES } from '../lib/validate-sample.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('development fixtures cover all 15 task types with >=2 samples each', () => {
  const samples = loadFixtures(path.join(root, 'development-fixtures.jsonl'));
  const byType = new Map();
  for (const s of samples) byType.set(s.task_type, (byType.get(s.task_type) || 0) + 1);
  for (const t of TASK_TYPES) {
    const count = byType.get(t) || 0;
    assert.ok(count >= 2, `task_type ${t} has only ${count} dev samples`);
  }
});

test('regression fixtures cover every task type (one each)', () => {
  const samples = loadFixtures(path.join(root, 'regression-fixtures.jsonl'));
  const types = new Set(samples.map((s) => s.task_type));
  for (const t of TASK_TYPES) {
    assert.ok(types.has(t), `regression set missing task_type ${t}`);
  }
});

test('sample ids unique within and across pools', () => {
  const dev = loadFixtures(path.join(root, 'development-fixtures.jsonl'));
  const reg = loadFixtures(path.join(root, 'regression-fixtures.jsonl'));
  const all = [...dev, ...reg].map((s) => s.sample_id);
  assert.equal(new Set(all).size, all.length, 'duplicate sample_id');
  const devPrefix = dev.every((s) => s.sample_id.startsWith('dev-'));
  const regPrefix = reg.every((s) => s.sample_id.startsWith('reg-'));
  assert.ok(devPrefix && regPrefix, 'namespaces must be dev-*/reg-*');
});

test('every dev sample carries all required decision-anatomy fields', () => {
  const samples = loadFixtures(path.join(root, 'development-fixtures.jsonl'));
  const required = ['goal', 'candidates', 'hard_constraints', 'soft_preferences',
    'valid_evidence', 'expired_evidence', 'conflicting_evidence',
    'historical_decisions', 'execution_results', 'expected_decision_action',
    'expected_action_detail', 'acceptable_explanation', 'severe_failure_label',
    'memory_timeline'];
  for (const s of samples) {
    for (const key of required) {
      assert.ok(key in s, `${s.sample_id} missing ${key}`);
    }
    assert.ok(Array.isArray(s.memory_timeline) && s.memory_timeline.length > 0, `${s.sample_id} empty timeline`);
    assert.ok(Array.isArray(s.candidates) && s.candidates.length >= 1, `${s.sample_id} no candidates`);
    assert.ok(Array.isArray(s.acceptable_explanation) && s.acceptable_explanation.length >= 1, `${s.sample_id} no acceptable explanation`);
  }
});
