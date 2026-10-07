import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDevPairs } from './generate-dev-paired-worlds.mjs';
import { auditDevPairs } from './audit-dev-benchmark.mjs';

test('generator is deterministic and produces 50 development pairs',()=>{
  const a=generateDevPairs(),b=generateDevPairs();
  assert.equal(a.length,50);
  assert.deepEqual(a,b);
  assert.ok(a.every(x=>x.construction_provenance.split==='dev'));
});

test('development benchmark passes construct and diversity gates',()=>{
  const r=auditDevPairs();
  assert.equal(r.pairs,50);
  assert.equal(r.all_validator_a_pass,true);
  assert.equal(r.all_validator_b_pass,true);
  assert.equal(r.clean_current_pairs,50);
  assert.equal(r.duplicate_surface_groups.length,0);
  assert.ok(r.max_template_concentration<=0.10);
  assert.equal(r.near_duplicate_pairs.length,0);
  assert.ok(Object.values(r.gates).every(Boolean));
});

test('every family and every domain is balanced',()=>{
  const r=auditDevPairs();
  for(const n of Object.values(r.family_counts))assert.equal(n,10);
  for(const n of Object.values(r.domain_counts))assert.equal(n,5);
});
