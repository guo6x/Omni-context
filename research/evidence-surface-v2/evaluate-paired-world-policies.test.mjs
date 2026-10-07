import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluatePairedPolicies } from './evaluate-paired-world-policies.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const r=evaluatePairedPolicies(path.join(HERE,'dev/paired-world-toy.jsonl'));

test('both deterministic surface-only policies emit identical outputs across each pair',()=>{
  for(const x of Object.values(r.by_policy)){
    assert.equal(x.identical_output_pairs,r.pairs);
  }
});

test('surface-vote incurs at least one violation in every decisive pair',()=>{
  const x=r.by_policy.SURFACE_VOTE;
  assert.equal(x.both_decisive_pairs,3);
  assert.equal(x.pair_with_any_violation_count,3);
  assert.equal(x.total_world_violations,3);
});

test('currentness-first still cannot break exact paired-world identity',()=>{
  const x=r.by_policy.CURRENTNESS_FIRST;
  assert.equal(x.both_decisive_pairs,3);
  assert.equal(x.pair_with_any_violation_count,3);
  assert.equal(x.total_world_violations,3);
});
