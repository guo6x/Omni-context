import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDevRetrievalBundle } from './generate-dev-retrieval-store.mjs';

const {inputs,truth}=generateDevRetrievalBundle();
const truthByCase=new Map(truth.map(x=>[x.case_id,x]));
const inputByCase=new Map(inputs.map(x=>[x.case_id,x]));

test('retrieval dev bundle has 50 paired A/B cases',()=>{
  assert.equal(inputs.length,100);
  assert.equal(truth.length,100);
  assert.equal(truth.filter(x=>x.member==='A').length,50);
  assert.equal(truth.filter(x=>x.member==='B').length,50);
  assert.equal(new Set(inputs.map(x=>x.case_id)).size,100);
});

test('retriever input contains no scoring truth fields',()=>{
  const forbidden=new Set([
    'pair_id','member','family','domain_id','target_document_id',
    'transition_slot_document_id','allowed_decisive_actions',
    'expected_visible_base_ids','is_target','surface_complete_truth',
    'ledger_profile','construction'
  ]);
  function walk(x,path='root'){
    if(Array.isArray(x)){for(const [i,v] of x.entries())walk(v,path+'['+i+']');return;}
    if(x&&typeof x==='object'){
      for(const [k,v] of Object.entries(x)){
        assert.equal(forbidden.has(k),false,'forbidden truth field '+path+'.'+k);
        walk(v,path+'.'+k);
      }
    }
  }
  for(const x of inputs)walk(x);
});

test('A and B stores are equal-size and differ only at one opaque matched slot',()=>{
  const byPair=new Map();
  for(const t of truth){
    if(!byPair.has(t.pair_id))byPair.set(t.pair_id,{});
    byPair.get(t.pair_id)[t.member]={truth:t,input:inputByCase.get(t.case_id)};
  }
  const tokenize=s=>(s.toLowerCase().match(/[a-z0-9]+/g)??[]);
  for(const {A,B} of byPair.values()){
    assert.equal(A.input.documents.length,11);
    assert.equal(B.input.documents.length,11);
    assert.equal(A.truth.transition_slot_document_id,B.truth.transition_slot_document_id);
    assert.equal(B.truth.transition_slot_document_id,B.truth.target_document_id);
    assert.deepEqual(A.input.documents.map(x=>x.document_id),B.input.documents.map(x=>x.document_id));

    const aById=new Map(A.input.documents.map(x=>[x.document_id,x]));
    const bById=new Map(B.input.documents.map(x=>[x.document_id,x]));
    for(const id of A.input.documents.map(x=>x.document_id)){
      const a=aById.get(id),b=bById.get(id);
      if(id===A.truth.transition_slot_document_id){
        assert.equal(a.role,'distractor');
        assert.deepEqual(a.supports_candidates,[]);
        assert.notDeepEqual(a,b);
        assert.equal(tokenize(a.fact).length,tokenize(b.fact).length);
      }else{
        assert.deepEqual(a,b);
      }
    }
  }
});

test('document and source ids are opaque and do not encode semantic roles',()=>{
  for(const x of inputs){
    for(const d of x.documents){
      assert.match(d.document_id,/^doc-[a-f0-9]{16}$/);
      assert.match(d.source_event_id,/^src-[a-f0-9]{16}$/);
      assert.doesNotMatch(d.document_id,/target|hidden|visible|distractor|transition/i);
      assert.doesNotMatch(d.source_event_id,/target|hidden|visible|distractor|transition/i);
    }
  }
});

test('truth sidecar binds every B target to the hidden-world valid candidate',()=>{
  for(const t of truth.filter(x=>x.member==='B')){
    const input=inputByCase.get(t.case_id);
    const d=input.documents.find(x=>x.document_id===t.target_document_id);
    assert.ok(d);
    const allowed=t.allowed_decisive_actions[0];
    assert.deepEqual(d.supports_candidates,[allowed.selected_candidate_id]);
  }
});
