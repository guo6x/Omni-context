import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { validateFile, validatePair } from './validate-paired-world.mjs';
import { validateFileB, validatePairB } from './validate-paired-world-b.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const toy=path.join(HERE,'dev/paired-world-toy.jsonl');
const pairs=fs.readFileSync(toy,'utf8').trim().split('\n').map(JSON.parse);

test('validator A and B both accept every dev pair',()=>{
  const a=validateFile(toy),b=validateFileB(toy);
  assert.equal(a.pairs,3);
  assert.equal(b.pairs,3);
  assert.equal(a.all_valid,true);
  assert.equal(b.all_valid,true);
});

test('validators agree on equality-breaking mutation',()=>{
  const p=JSON.parse(JSON.stringify(pairs[0]));
  p.world_b.policy_input.evidence[0].fact+=' changed';
  assert.equal(validatePair(p).valid,false);
  assert.equal(validatePairB(p).valid,false);
});

test('validators agree on action-overlap mutation',()=>{
  const p=JSON.parse(JSON.stringify(pairs[1]));
  p.world_b.allowed_decisive_actions=JSON.parse(JSON.stringify(p.world_a.allowed_decisive_actions));
  assert.equal(validatePair(p).valid,false);
  assert.equal(validatePairB(p).valid,false);
});

test('validators agree on hidden event id leakage',()=>{
  const p=JSON.parse(JSON.stringify(pairs[2]));
  const hidden=p.world_b.hidden_state.hidden_events[0].event_id;
  p.world_a.policy_input.evidence[0].source_event_id=hidden;
  p.world_b.policy_input.evidence[0].source_event_id=hidden;
  assert.equal(validatePair(p).valid,false);
  assert.equal(validatePairB(p).valid,false);
});
