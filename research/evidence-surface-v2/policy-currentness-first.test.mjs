import test from 'node:test';
import assert from 'node:assert/strict';
import { currentnessFirstPolicy } from './policy-currentness-first.mjs';
import { evaluateIndependentPolicyV1 } from './evaluate-independent-policy-v1.mjs';

test('superseded current_fact forces fallback',()=>{
  const r=currentnessFirstPolicy({
    candidates:[{candidate_id:'a'},{candidate_id:'b'}],
    evidence:[
      {evidence_id:'old',role:'current_fact',currentness:'superseded',supports_candidates:['a']},
      {evidence_id:'ready',role:'current_fact',currentness:'current',supports_candidates:['a']}
    ]
  });
  assert.equal(r.decisive,false);
  assert.match(r.reason,/NONCURRENT_CURRENT_FACT/);
});

test('stale_fact can be ignored when current replacement is visible',()=>{
  const r=currentnessFirstPolicy({
    candidates:[{candidate_id:'a'},{candidate_id:'b'}],
    evidence:[
      {evidence_id:'old',role:'stale_fact',currentness:'superseded',supports_candidates:['a']},
      {evidence_id:'new',role:'current_fact',currentness:'current',supports_candidates:['b']}
    ]
  });
  assert.equal(r.decisive,true);
  assert.equal(r.selected_candidate_id,'b');
});

test('current override is honored',()=>{
  const r=currentnessFirstPolicy({
    candidates:[{candidate_id:'a'},{candidate_id:'b'}],
    evidence:[{evidence_id:'o',role:'override',currentness:'current',supports_candidates:['b']}]
  });
  assert.deepEqual([r.decisive,r.action_family,r.selected_candidate_id],[true,'HONOR_OVERRIDE','b']);
});

test('V1 F6 hidden override is caught by independent currentness policy',()=>{
  const r=evaluateIndependentPolicyV1();
  const f6=r.by_family.F6.C1_HIDDEN;
  assert.equal(f6.decisive_count,0);
  assert.equal(f6.wavr_count,0);
  assert.equal(f6.fallback_count,30);
});
