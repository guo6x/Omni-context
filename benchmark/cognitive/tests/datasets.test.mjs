import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_KEYS, CATEGORY_SPECS } from '../src/constants.mjs';
import { generateSplit, selectComparisonSubset } from '../src/scenarios.mjs';

test('generates isolated Smoke, Development, Formal Draft, and Comparison Draft sets', () => {
  const smoke = generateSplit('smoke');
  const development = generateSplit('development');
  const formal = generateSplit('formal');
  const comparison = selectComparisonSubset(formal);
  assert.equal(smoke.length, 21);
  assert.equal(development.length, 35);
  assert.equal(formal.length, 250);
  assert.equal(comparison.length, 70);
  assert.equal(new Set([...smoke, ...development, ...formal].map((s) => s.scenario_id)).size, 306);
  assert.equal(new Set(comparison).size, 70);
  for (const category of CATEGORY_KEYS) {
    assert.equal(smoke.filter((s) => s.category === category).length, 3);
    assert.equal(development.filter((s) => s.category === category).length, 5);
    assert.equal(formal.filter((s) => s.category === category).length, CATEGORY_SPECS[category].formal_count);
    assert.equal(comparison.filter((id) => id.includes(`-${category}-`)).length, 10);
  }
  assert.ok(formal.every((scenario) => scenario.official_locomo === false));
});

test('difficulty derives from objective scenario position, not expected system correctness', () => {
  const formal = generateSplit('formal');
  for (const category of CATEGORY_KEYS) {
    const rows = formal.filter((s) => s.category === category);
    const counts = Object.fromEntries(['easy', 'medium', 'hard'].map((level) => [level, rows.filter((s) => s.difficulty === level).length]));
    assert.equal(counts.easy + counts.medium + counts.hard, CATEGORY_SPECS[category].formal_count);
    assert.ok(counts.easy > 0 && counts.medium > 0 && counts.hard > 0);
  }
});
