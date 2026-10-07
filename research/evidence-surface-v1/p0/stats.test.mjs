import test from 'node:test';
import assert from 'node:assert/strict';
import { exactMcNemarTwoSided, pairedBinarySummary } from './stats.mjs';

test('exact McNemar returns 1 with no discordant pairs', () => {
  assert.equal(exactMcNemarTwoSided(0, 0), 1);
});

test('exact McNemar is symmetric', () => {
  assert.equal(exactMcNemarTwoSided(8, 1), exactMcNemarTwoSided(1, 8));
});

test('exact McNemar known extreme', () => {
  // 10 discordant pairs all in one direction: 2 * (1/2^10)
  assert.ok(Math.abs(exactMcNemarTwoSided(10, 0) - 0.001953125) < 1e-12);
});

test('paired summary uses unsupported=true convention', () => {
  const out = pairedBinarySummary([
    { full: false, hidden: true },
    { full: false, hidden: true },
    { full: false, hidden: false },
    { full: true, hidden: true },
  ]);
  assert.equal(out.n, 4);
  assert.equal(out.n01, 2);
  assert.equal(out.n10, 0);
  assert.equal(out.full_rate, 0.25);
  assert.equal(out.hidden_rate, 0.75);
  assert.equal(out.risk_difference_hidden_minus_full, 0.5);
});
