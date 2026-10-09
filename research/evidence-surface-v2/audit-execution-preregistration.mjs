import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base='research/evidence-surface-v2/';
const read=p=>JSON.parse(fs.readFileSync(path.join(root,base+p),'utf8'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,base+p))).digest('hex');

export function auditPreregistration(){
 const snap=read('EXECUTION_PREREGISTRATION_SNAPSHOT.json');
 const matrix=read('EXECUTION_MATRIX.json');
 const corpus=read('confirmatory/frozen/FREEZE_RECORD.json');
 const retrieval=read('confirmatory/retrieval-construction/FREEZE_RECORD.json');
 const execFreeze=read('EXECUTION_SOURCE_FREEZE.json');
 const retFreeze=read('RETRIEVAL_EXECUTION_SOURCE_FREEZE.json');
 const llm=fs.readFileSync(path.join(root,base+'LLM_REPLICATION_DECISION.md'),'utf8');
 const errors=[];
 const expect=(value,description)=>{if(!value)errors.push(description);};
 expect(snap.status==='FROZEN_PRE_OUTCOME_NOT_AUTHORIZED','snapshot state');
 expect(matrix.status==='FROZEN_PRE_OUTCOME_MATRIX','matrix state');
 expect(snap.frozen_pair_corpus_sha256===corpus.frozen_corpus_sha256,'pair corpus SHA binding');
 expect(sha('confirmatory/frozen/paired-worlds.jsonl')===corpus.frozen_corpus_sha256,'actual corpus SHA');
 expect(snap.frozen_retrieval_input_sha256===retrieval.retriever_input_sha256,'retrieval input SHA');
 expect(snap.frozen_retrieval_truth_sha256===retrieval.scoring_truth_sha256,'retrieval truth SHA');
 expect(execFreeze.frozen_pair_corpus_sha256===corpus.frozen_corpus_sha256,'execution source corpus binding');
 expect(retFreeze.frozen_pair_corpus_sha256===corpus.frozen_corpus_sha256,'retrieval source corpus binding');
 expect(snap.pair_count===160&&snap.world_count===320,'paired corpus size');
 expect(snap.paired_surface_condition_count===9&&matrix.paired_surface_conditions.length===9,'paired condition count');
 expect(snap.expected_paired_surface_rows===160*9,'paired output cardinality');
 expect(snap.retrieval_case_count===320&&snap.retrieval_condition_count===12&&matrix.retrieval_conditions.length===12,'retrieval condition count');
 expect(snap.expected_retrieval_scored_rows===320*12,'retrieval output cardinality');
 const ids=[...matrix.paired_surface_conditions,...matrix.retrieval_conditions].map(x=>x.condition_id);
 expect(new Set(ids).size===21,'duplicate condition IDs');
 const m1=matrix.paired_surface_conditions.filter(x=>x.monitor==='M1_ALWAYS_DEFER');
 expect(m1.length===1&&m1[0]?.policy==='P_NONE','always-defer must be unique');
 expect(snap.llm_replication.enabled===false&&snap.llm_replication.models.length===0,'LLM conditions must be off');
 expect(matrix.declarations.llm_replication_enabled===false,'matrix LLM flag');
 expect(llm.includes('OMIT LLM POLICY REPLICATION'),'LLM decision memo exists');
 const sourceNames=Object.keys(execFreeze.git_blob_guards??{});
 expect(sourceNames.includes('research/evidence-surface-v2/EXECUTION_MATRIX.json'),'execution source matrix guard');
 expect(sourceNames.includes('research/evidence-surface-v2/run-paired-surface-matrix.mjs'),'paired runner guard');
 expect(Object.keys(retFreeze.git_blob_guards??{}).includes('research/evidence-surface-v2/run-dev-retrievers.py'),'retrieval runner guard');
 return {
  status:errors.length?'FAIL':'PASS',
  errors,
  preregistration_sha256:sha('EXECUTION_PREREGISTRATION_SNAPSHOT.json'),
  matrix_sha256:sha('EXECUTION_MATRIX.json'),
  frozen_corpus_sha256:corpus.frozen_corpus_sha256,
  retrieval_input_sha256:retrieval.retriever_input_sha256,
  retrieval_truth_sha256:retrieval.scoring_truth_sha256,
  paired_condition_count:matrix.paired_surface_conditions.length,
  retrieval_condition_count:matrix.retrieval_conditions.length,
  confirmatory_outcome_executed:false
 };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const r=auditPreregistration();
 console.log(JSON.stringify(r,null,2));
 if(r.status!=='PASS')process.exit(1);
}
