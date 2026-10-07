import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDevRetrievalCases } from './generate-dev-retrieval-store.mjs';

const cases=generateDevRetrievalCases();

test('retrieval dev store has 50 paired A/B cases',()=>{
  assert.equal(cases.length,100);
  assert.equal(cases.filter(x=>x.member==='A').length,50);
  assert.equal(cases.filter(x=>x.member==='B').length,50);
});

test('A and B have equal-size stores and a matched transition slot',()=>{
  const byPair=new Map();
  const tokenize=s=>(s.toLowerCase().match(/[a-z0-9]+/g)??[]);
  for(const c of cases){
    if(!byPair.has(c.pair_id))byPair.set(c.pair_id,{});
    byPair.get(c.pair_id)[c.member]=c;
  }
  for(const {A,B} of byPair.values()){
    assert.equal(A.target_document_id,null);
    assert.ok(B.target_document_id);
    assert.equal(A.documents.length,11);
    assert.equal(B.documents.length,11);
    assert.equal(A.transition_slot_document_id,B.transition_slot_document_id);
    assert.equal(B.transition_slot_document_id,B.target_document_id);
    assert.deepEqual(A.documents.map(x=>x.document_id),B.documents.map(x=>x.document_id));

    const aById=new Map(A.documents.map(x=>[x.document_id,x]));
    const bById=new Map(B.documents.map(x=>[x.document_id,x]));
    for(const id of A.documents.map(x=>x.document_id)){
      const a=aById.get(id),b=bById.get(id);
      if(id===A.transition_slot_document_id){
        assert.equal(a.kind,'matched_control');
        assert.equal(a.is_target,false);
        assert.deepEqual(a.supports_candidates,[]);
        assert.equal(b.kind,'hidden_transition');
        assert.equal(b.is_target,true);
        assert.equal(tokenize(a.fact).length,tokenize(b.fact).length);
      }else{
        assert.deepEqual(a,b);
      }
    }
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
