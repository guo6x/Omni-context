import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, 'out', 'p0-pairs.jsonl');

test('P0 builder and verifier run without provider calls', () => {
  const b = spawnSync(process.execPath, [path.join(here, 'build-pairs.mjs')], { encoding: 'utf8' });
  assert.equal(b.status, 0, b.stderr || b.stdout);
  const v = spawnSync(process.execPath, [path.join(here, 'verify-p0.mjs')], { encoding: 'utf8' });
  assert.equal(v.status, 0, v.stderr || v.stdout);
  assert.match(v.stdout, /P0_HARNESS_VERIFIED/);
});

test('P0 output has exactly one FULL and one HIDDEN row per TT08 sample', () => {
  const rows = fs.readFileSync(OUT, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 16);
  const ids = [...new Set(rows.map((r) => r.source_sample_id))];
  assert.equal(ids.length, 8);
  for (const id of ids) {
    const rs = rows.filter((r) => r.source_sample_id === id);
    assert.deepEqual(rs.map((r) => r.condition).sort(), ['FULL', 'HIDDEN']);
  }
});
