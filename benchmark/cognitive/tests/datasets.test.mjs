import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateAudit, familyAudit, difficultyAudit } from '../src/audits.mjs';
import { CATEGORY_KEYS, CATEGORY_SPECS } from '../src/constants.mjs';
import { generateSplit, selectComparisonSubset } from '../src/scenarios.mjs';

test('generates isolated v2 sets and preselects 70 comparison IDs', () => {
  const smoke = generateSplit('smoke');
  const development = generateSplit('development');
  const formal = generateSplit('formal');
  const comparison = selectComparisonSubset(formal);
  assert.deepEqual([smoke.length, development.length, formal.length, comparison.length], [21, 35, 250, 70]);
  assert.equal(new Set([...smoke, ...development, ...formal].map((scenario) => scenario.scenario_id)).size, 306);
  assert.equal(new Set(comparison).size, 70);
  for (const category of CATEGORY_KEYS) {
    assert.equal(formal.filter((scenario) => scenario.category === category).length, CATEGORY_SPECS[category].formal_count);
    assert.equal(comparison.filter((id) => id.includes(`-${category}-`)).length, 10);
  }
});

test('passes family, duplicate, and real structural difficulty audits', () => {
  const development = generateSplit('development');
  const formal = generateSplit('formal');
  assert.equal(duplicateAudit(formal).status, 'pass');
  const families = familyAudit(formal, development);
  assert.equal(families.status, 'pass');
  for (const category of CATEGORY_KEYS) {
    assert.ok(families.formal[category].family_count >= 5);
    assert.ok(families.formal[category].max_family_share <= 0.25);
    assert.ok(families.development[category].family_count >= 3);
    assert.deepEqual(new Set(development.filter((scenario) => scenario.category === category).map((scenario) => scenario.difficulty)), new Set(['easy', 'medium', 'hard']));
  }
  assert.equal(difficultyAudit(formal).status, 'pass');
});
