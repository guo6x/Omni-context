import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateDevRetrievalBundle } from './generate-dev-retrieval-store.mjs';
import { scoreRetrieval } from './score-dev-retrieval.mjs';

function tmpFiles(inputs,truth,rankingRows){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'es-v2-retrieval-score-'));
  const input=path.join(dir,'input.jsonl');
  const truthFile=path.join(dir,'truth.jsonl');
  const rank=path.join(dir,'rank.json');
  fs.writeFileSync(input,inputs.map(x=>JSON.stringify(x)).join('\n')+'\n');
  fs.writeFileSync(truthFile,truth.map(x=>JSON.stringify(x)).join('\n')+'\n');
  fs.writeFileSync(rank,JSON.stringify({schema_version:1,rows:rankingRows},null,2));
  return {dir,input,truthFile,rank};
}

const bundle=generateDevRetrievalBundle();
const truthByCase=new Map(bundle.truth.map(x=>[x.case_id,x]));

test('retrieving hidden revocation changes independent policy from violation to correct decisive action',()=>{
  const t=bundle.truth.find(x=>x.member==='B'&&x.family==='REVOCATION');
  const input=bundle.inputs.find(x=>x.case_id===t.case_id);
  assert.ok(t&&input);
  const target=t.target_document_id;
  const base=t.expected_visible_base_ids;

  const {dir,input:inputFile,truthFile,rank}=tmpFiles([input],[t],[
    {case_id:t.case_id,retriever:'SYNTHETIC_MISS',k:2,document_ids:base.slice(0,2)},
    {case_id:t.case_id,retriever:'SYNTHETIC_HIT',k:3,document_ids:[...base.slice(0,2),target]}
  ]);
  try{
    const r=scoreRetrieval(inputFile,truthFile,rank);
    const miss=r.rows.find(x=>x.retriever==='SYNTHETIC_MISS'&&x.policy==='CURRENTNESS_FIRST');
    const hit=r.rows.find(x=>x.retriever==='SYNTHETIC_HIT'&&x.policy==='CURRENTNESS_FIRST');
    assert.equal(miss.target_hit,false);
    assert.equal(miss.decisive,true);
    assert.equal(miss.world_action_violation,true);
    assert.equal(hit.target_hit,true);
    assert.equal(hit.decisive,true);
    assert.equal(hit.world_action_violation,false);
    assert.equal(hit.correct_decisive,true);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('scorer never treats non-decisive output as world-action violation',()=>{
  const t=bundle.truth.find(x=>x.member==='B'&&x.family==='AUTHORITY_WITHDRAWAL');
  const input=bundle.inputs.find(x=>x.case_id===t.case_id);
  const distractor=input.documents.find(x=>x.role==='distractor'&&x.document_id!==t.transition_slot_document_id);
  const {dir,input:inputFile,truthFile,rank}=tmpFiles([input],[t],[
    {case_id:t.case_id,retriever:'SYNTHETIC_EMPTY_SUPPORT',k:1,document_ids:[distractor.document_id]}
  ]);
  try{
    const r=scoreRetrieval(inputFile,truthFile,rank);
    for(const row of r.rows){
      assert.equal(row.decisive,false);
      assert.equal(row.world_action_violation,false);
    }
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('scorer refuses ranking cases without a truth sidecar row',()=>{
  const input=bundle.inputs[0];
  const {dir,input:inputFile,truthFile,rank}=tmpFiles([input],[],[
    {case_id:input.case_id,retriever:'SYNTHETIC',k:1,document_ids:[input.documents[0].document_id]}
  ]);
  try{
    assert.throws(()=>scoreRetrieval(inputFile,truthFile,rank),/input\/truth case count mismatch|truth missing case/);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
