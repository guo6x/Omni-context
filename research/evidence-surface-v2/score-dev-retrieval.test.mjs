import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateDevRetrievalCases } from './generate-dev-retrieval-store.mjs';
import { scoreRetrieval } from './score-dev-retrieval.mjs';

function tmpFiles(sourceCases,rankingRows){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'es-v2-retrieval-score-'));
  const source=path.join(dir,'source.jsonl');
  const rank=path.join(dir,'rank.json');
  fs.writeFileSync(source,sourceCases.map(x=>JSON.stringify(x)).join('\n')+'\n');
  fs.writeFileSync(rank,JSON.stringify({schema_version:1,rows:rankingRows},null,2));
  return {dir,source,rank};
}

test('retrieving hidden revocation changes independent policy from violation to correct decisive action',()=>{
  const c=generateDevRetrievalCases().find(x=>x.member==='B'&&x.family==='REVOCATION');
  assert.ok(c);
  const target=c.target_document_id;
  const base=c.expected_visible_base_ids;

  const {dir,source,rank}=tmpFiles([c],[
    {case_id:c.case_id,retriever:'SYNTHETIC_MISS',k:2,document_ids:base.slice(0,2)},
    {case_id:c.case_id,retriever:'SYNTHETIC_HIT',k:3,document_ids:[...base.slice(0,2),target]}
  ]);
  try{
    const r=scoreRetrieval(source,rank);
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
  const c=generateDevRetrievalCases().find(x=>x.member==='B'&&x.family==='AUTHORITY_WITHDRAWAL');
  const distractor=c.documents.find(x=>x.kind==='distractor');
  const {dir,source,rank}=tmpFiles([c],[
    {case_id:c.case_id,retriever:'SYNTHETIC_EMPTY_SUPPORT',k:1,document_ids:[distractor.document_id]}
  ]);
  try{
    const r=scoreRetrieval(source,rank);
    for(const row of r.rows){
      assert.equal(row.decisive,false);
      assert.equal(row.world_action_violation,false);
    }
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
