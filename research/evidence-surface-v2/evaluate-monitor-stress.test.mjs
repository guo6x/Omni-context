import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateStress } from './evaluate-monitor-stress.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const r=evaluateStress(path.join(HERE,'dev/monitor-stress.jsonl'));

test('stress set contains intended error classes',()=>{
  assert.equal(r.cases,7);
  assert.equal(r.false_complete_count,2);
  assert.equal(r.false_incomplete_count,1);
  assert.equal(r.correct_count,4);
});

test('benign source advance exposes conservative false-incomplete',()=>{
  const x=r.by_class.BENIGN_SOURCE_ADVANCE;
  assert.equal(x.truth_complete,true);
  assert.equal(x.predicted_complete,false);
  assert.equal(x.false_incomplete,true);
  assert.ok(x.reasons.some(y=>y.startsWith('SOURCE_AHEAD:')));
});

test('stale source head exposes false-complete',()=>{
  const x=r.by_class.STALE_SOURCE_HEAD;
  assert.equal(x.truth_complete,false);
  assert.equal(x.predicted_complete,true);
  assert.equal(x.false_complete,true);
});

test('untracked relevant channel exposes inventory failure',()=>{
  const x=r.by_class.UNTRACKED_RELEVANT_CHANNEL;
  assert.equal(x.truth_complete,false);
  assert.equal(x.predicted_complete,true);
  assert.equal(x.false_complete,true);
});

test('explicit acquisition failures are detected',()=>{
  assert.equal(r.by_class.INDEX_INCOMPLETE.predicted_complete,false);
  assert.equal(r.by_class.RETRIEVAL_INCOMPLETE.predicted_complete,false);
  assert.equal(r.by_class.MISSING_REQUIRED_CHANNEL.predicted_complete,false);
});
