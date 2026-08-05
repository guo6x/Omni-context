import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateSample } from '../lib/validate-sample.mjs';
import { loadFixtures } from '../lib/validate-sample.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('development fixtures: every line parses and validates', () => {
  const samples = loadFixtures(path.join(root, 'development-fixtures.jsonl'));
  assert.ok(samples.length >= 30, `expected >=30 dev samples, got ${samples.length}`);
  samples.forEach((s, i) => {
    const errors = validateSample(s, { index: i + 1 });
    assert.deepEqual(errors, [], `dev sample ${s.sample_id} errors: ${errors.join('; ')}`);
  });
});

test('regression fixtures: every line parses and validates', () => {
  const samples = loadFixtures(path.join(root, 'regression-fixtures.jsonl'));
  assert.ok(samples.length >= 10, `expected >=10 regression samples, got ${samples.length}`);
  samples.forEach((s, i) => {
    const errors = validateSample(s, { index: i + 1 });
    assert.deepEqual(errors, [], `reg sample ${s.sample_id} errors: ${errors.join('; ')}`);
  });
});

test('validator rejects malformed samples (negative control)', () => {
  const base = {
    schema_version: 'decision-benchmark-v1',
    sample_id: 'dev-999',
    task_type: 1,
    title: 'neg',
    narrative: 'narrative',
    memory_timeline: [{ t: '2026-01-01T00:00:00Z', kind: 'goal', content: 'g' }],
    goal: 'g',
    candidates: [{ id: 'a', label: 'A', description: 'd' }],
    hard_constraints: [],
    soft_preferences: [],
    valid_evidence: [],
    expired_evidence: [],
    conflicting_evidence: [],
    historical_decisions: [],
    execution_results: [],
    expected_decision_action: 'decide',
    expected_action_detail: { action: 'decide', selected_candidate: 'a' },
    acceptable_explanation: [{ feature: 'f', must_mention: ['x'] }],
    severe_failure_label: 'none',
    tags: [],
  };
  assert.deepEqual(validateSample({ ...base }), []);
  assert.ok(validateSample({ ...base, sample_id: 'bad-id' }).length > 0, 'bad id rejected');
  assert.ok(validateSample({ ...base, task_type: 99 }).length > 0, 'bad type rejected');
  assert.ok(validateSample({ ...base, expected_decision_action: 'revise' }).length > 0, 'illegal action rejected');
  assert.ok(validateSample({ ...base, expected_action_detail: { action: 'decide', selected_candidate: 'nope' } }).length > 0, 'bad candidate rejected');
  assert.ok(validateSample({ ...base, severe_failure_label: 'nope' }).length > 0, 'bad label rejected');
  assert.ok(validateSample({ ...base, acceptable_explanation: [] }).length > 0, 'empty explanation rejected');
});
