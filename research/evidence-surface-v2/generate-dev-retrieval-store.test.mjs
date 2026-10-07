import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDevRetrievalCases } from './generate-dev-retrieval-store.mjs';

const cases=generateDevRetrievalCases();

test('retrieval dev store has 50 paired A/B cases',()=>{
  assert.equal(cases.length,100);
  assert.equal(cases.filter(x=>x.member==='A').length,50);
  assert.equal(cases.filter(x=>x.member==='B').length,50);
});

test('A and B differ only by the hidden target document at source-store level',()=>{
  const byPair=new Map();
  for(const c of cases){
    if(!byPair.has(c.pair_id))byPair.set(c.pair_id,{});
    byPair.get(c.pair_id)[c.member]=c;
  }
  for(const {A,B} of byPair.values()){
    assert.equal(A.target_document_id,null);
    assert.ok(B.target_document_id);
    assert.equal(A.documents.length,10);
    assert.equal(B.documents.length,11);
    const aIds=new Set(A.documents.map(x=>x.document_id));
    const extras=B.documents.filter(x=>!aIds.has(x.document_id));
    assert.equal(extras.length,1);
    assert.equal(extras[0].document_id,B.target_document_id);
    assert.equal(extras[0].is_target,true);
  }
});

test('distractors carry no candidate support',()=>{
  for(const c of cases){
    for(const d of c.documents.filter(x=>x.kind==='distractor')){
      assert.deepEqual(d.supports_candidates,[]);
      assert.equal(d.currentness,'current');
    }
  }
});

test('every B target supports the hidden-world valid candidate',()=>{
  for(const c of cases.filter(x=>x.member==='B')){
    const t=c.documents.find(x=>x.document_id===c.target_document_id);
    const allowed=c.allowed_decisive_actions[0];
    assert.deepEqual(t.supports_candidates,[allowed.selected_candidate_id]);
  }
});
