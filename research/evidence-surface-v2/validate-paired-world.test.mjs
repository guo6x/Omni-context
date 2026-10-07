import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePair, validateFile } from './validate-paired-world.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const toy=path.join(HERE,'dev/paired-world-toy.jsonl');
const pairs=fs.readFileSync(toy,'utf8').trim().split('\n').map(JSON.parse);

test('development paired worlds pass exact-surface contract',()=>{
  const r=validateFile(toy);
  assert.equal(r.pairs,3);
  assert.equal(r.valid_pairs,3);
  assert.equal(r.all_valid,true);
  assert.equal(r.all_policy_inputs_exact,true);
  assert.equal(r.all_decisive_truth_disjoint,true);
  for(const p of r.results) assert.equal(p.policy_input_hash_a,p.policy_input_hash_b);
});

test('one visible metadata mutation breaks indistinguishability',()=>{
  const p=structuredClone(pairs[0]);
  p.world_b.policy_input.evidence[0].currentness='superseded';
  const r=validatePair(p);
  assert.equal(r.valid,false);
  assert.ok(r.errors.includes('policy inputs are not exactly equal'));
});

test('overlapping decisive truth is rejected',()=>{
  const p=structuredClone(pairs[0]);
  p.world_b.allowed_decisive_actions=structuredClone(p.world_a.allowed_decisive_actions);
  const r=validatePair(p);
  assert.equal(r.valid,false);
  assert.ok(r.errors.some(x=>x.startsWith('allowed decisive actions overlap')));
});

test('Gold-like field in policy input is rejected',()=>{
  const p=structuredClone(pairs[0]);
  p.world_a.policy_input.gold='hidden';
  p.world_b.policy_input.gold='hidden';
  const r=validatePair(p);
  assert.equal(r.valid,false);
  assert.ok(r.errors.some(x=>x.startsWith('forbidden policy-input fields')));
});

test('hidden event id cannot appear as visible source id',()=>{
  const p=structuredClone(pairs[0]);
  const id=p.world_b.hidden_state.hidden_events[0].event_id;
  p.world_a.policy_input.evidence[0].source_event_id=id;
  p.world_b.policy_input.evidence[0].source_event_id=id;
  const r=validatePair(p);
  assert.equal(r.valid,false);
  assert.ok(r.errors.some(x=>x.includes('hidden event ids leak')));
});
