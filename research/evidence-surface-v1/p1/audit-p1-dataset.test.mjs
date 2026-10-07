import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDataset } from './audit-p1-dataset.mjs';

function sample(id,family,question,fact){
 return {
  sample_id:id,family,domain:'toy',question,
  source_events:[{event_id:'src-001',content:'source '+fact}],
  candidates:[{candidate_id:'opt-a',label:'A',description:'A'},{candidate_id:'opt-b',label:'B',description:'B'}],
  evidence:[{evidence_id:'ev-001',fact,source_event_id:'src-001'}],
  constructor_proposal:{treatment_target_evidence_id:'ev-001'}
 };
}

test('audit catches missing treatment target',()=>{
 const s=sample('es-v1-f1-001','F1','choose A or B','compatibility is required');
 s.constructor_proposal.treatment_target_evidence_id='ev-999';
 const r=auditDataset([s]);
 assert.equal(r.pass,false);
 assert.equal(r.errors[0].type,'TREATMENT_TARGET_MISSING');
});

test('audit emits near duplicate warning',()=>{
 const a=sample('es-v1-f1-001','F1','choose alpha for the project','alpha is supported by current evidence');
 const b=sample('es-v1-f1-002','F1','choose alpha for the project','alpha is supported by current evidence');
 const r=auditDataset([a,b],0.5);
 assert.ok(r.warnings.some(x=>x.type==='NEAR_DUPLICATE'));
});
