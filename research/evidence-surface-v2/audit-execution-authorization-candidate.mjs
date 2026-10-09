import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateJsonDocument} from './validate-json-document-schema.mjs';

const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const pref='research/evidence-surface-v2/';
const location=name=>path.join(base,pref+name);
const json=name=>JSON.parse(fs.readFileSync(location(name),'utf8'));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function auditPreparedAuthorization(){
 const errors=[];
 const authFile=location('EXECUTION_AUTHORIZATION.json');
 const validation=validateJsonDocument(location('execution-authorization.schema.json'),authFile);
 errors.push(...validation.errors);
 if(!validation.valid)return {status:'FAIL',errors};
 const auth=json('EXECUTION_AUTHORIZATION.json');
 const readiness=json('EXECUTION_READINESS.json');
 const snap=json('EXECUTION_PREREGISTRATION_SNAPSHOT.json');
 const frozen=json('confirmatory/frozen/FREEZE_RECORD.json');
 const records=[
  json('EXECUTION_SOURCE_FREEZE.json'),
  json('RETRIEVAL_EXECUTION_SOURCE_FREEZE.json'),
  json('confirmatory/retrieval-construction/FREEZE_RECORD.json')
 ];
 const eq=(ok,reason)=>{if(!ok)errors.push(reason)};
 const prepared=auth.status==='PREPARED_NOT_AUTHORIZED';
 const authorized=auth.status==='AUTHORIZED';
 eq(prepared||authorized,'authorization has unrecognized state');
 eq(auth.confirmatory_execution_authorized===authorized,'authorization status/flag mismatch');
 eq(readiness.confirmatory_execution_authorized===authorized,'readiness/authorization mismatch');
 eq(readiness.status===(authorized?'AUTHORIZED':'BLOCKED_FINAL_AUTHORIZATION_ONLY'),'readiness status mismatch');
 eq(auth.llm_replication?.enabled===false&&auth.llm_replication?.models?.length===0,'LLM replication enabled');
 eq(auth.preregistration_snapshot.path===pref+'EXECUTION_PREREGISTRATION_SNAPSHOT.json','unrecognized snapshot');
 eq(auth.preregistration_snapshot.sha256===sha(location('EXECUTION_PREREGISTRATION_SNAPSHOT.json')),'prereg snapshot sha mismatch');
 eq(auth.frozen_corpus_sha256===frozen.frozen_corpus_sha256,'corpus record hash mismatch');
 eq(sha(location('confirmatory/frozen/paired-worlds.jsonl'))===frozen.frozen_corpus_sha256,'corpus bytes mismatch');
 eq(snap.status==='FROZEN_PRE_OUTCOME_NOT_AUTHORIZED','prereg not frozen');
 if(prepared)eq(!fs.existsSync(location('EXECUTION_REQUEST.json')),'prepared authorization cannot have execution request');

 const mandatory=new Set([
  pref+'EXECUTION_PREREGISTRATION_SNAPSHOT.json',
  pref+'EXECUTION_MATRIX.json',
  pref+'EXECUTION_READINESS.json',
  pref+'execution-authorization.schema.json',
  pref+'execution-request.schema.json',
  pref+'validate-execution-authorization.mjs',
  '.github/workflows/research-evidence-v2-confirmatory-execution.yml',
  pref+'EXECUTION_SOURCE_FREEZE.json',
  pref+'RETRIEVAL_EXECUTION_SOURCE_FREEZE.json',
  pref+'confirmatory/retrieval-construction/FREEZE_RECORD.json'
 ]);
 for(const r of records){
  for(const [p,h] of Object.entries(r.git_blob_guards??{})){
   mandatory.add(p);
   if(auth.git_blob_guards[p]!==h)errors.push('frozen guard disagreement: '+p);
  }
 }
 for(const p of mandatory){
  const stored=auth.git_blob_guards[p];
  if(!stored){errors.push('missing mandatory guard: '+p);continue}
  try{
   const current=cp.execFileSync('git',['hash-object',p],{cwd:base,encoding:'utf8'}).trim();
   if(current!==stored)errors.push('stale guard: '+p);
  }catch(e){errors.push('guard file inaccessible: '+p)}
 }
 return {
  status:errors.length?'FAIL':'PASS',
  errors,
  authorization_id:auth.authorization_id,
  authorization_sha256:sha(authFile),
  preregistration_sha256:auth.preregistration_snapshot.sha256,
  guarded_file_count:Object.keys(auth.git_blob_guards).length,
  required_guard_count:mandatory.size,
  ready_for_execution:authorized,
  outcome_executed:false
 };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const r=auditPreparedAuthorization();
 console.log(JSON.stringify(r,null,2));
 if(r.status!=='PASS')process.exit(1);
}
