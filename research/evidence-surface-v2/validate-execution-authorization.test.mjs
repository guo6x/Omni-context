import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateExecutionAuthorization} from './validate-execution-authorization.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const digest=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const guard='research/evidence-surface-v2/validate-json-document-schema.mjs';
const corpus=path.join(here,'dev/paired-world-toy.jsonl');
const prereg='research/evidence-surface-v2/EXECUTION_PREREGISTRATION_SNAPSHOT.json';

function fixture(o={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v2-auth-'));
 const blob=cp.execFileSync('git',['hash-object',guard],{cwd:root,encoding:'utf8'}).trim();
 const auth={
  schema_version:1,authorization_id:'ESV2-CONF-TEST',status:'AUTHORIZED',
  confirmatory_execution_authorized:true,frozen_corpus_sha256:digest(corpus),
  git_blob_guards:{[guard]:blob},llm_replication:{enabled:false,models:[]},
  preregistration_snapshot:{path:prereg,sha256:digest(path.join(root,prereg))},
  ...o.auth
 };
 const af=path.join(dir,'auth.json'),rf=path.join(dir,'request.json'),ready=path.join(dir,'readiness.json');
 fs.writeFileSync(af,JSON.stringify(auth));
 fs.writeFileSync(rf,JSON.stringify({
   schema_version:1,authorization_id:auth.authorization_id,
   authorization_sha256:digest(af),execute:true,...o.request
 }));
 fs.writeFileSync(ready,JSON.stringify({
   status:'AUTHORIZED',confirmatory_execution_authorized:true,...o.readiness
 }));
 return {dir,af,rf,ready};
}
function check(x){
 return validateExecutionAuthorization({
  requestFile:x.rf,authorizationFile:x.af,readinessFile:x.ready,corpusFile:corpus,
  requestSchemaFile:path.join(here,'execution-request.schema.json'),
  authorizationSchemaFile:path.join(here,'execution-authorization.schema.json'),
  repoRoot:root
 });
}
function withFixture(o,fn){
 const x=fixture(o);
 try{fn(x);}finally{fs.rmSync(x.dir,{recursive:true,force:true});}
}
test('valid synthetic authorization passes',()=>withFixture({},x=>{
 assert.deepEqual(check(x).errors,[]);
}));
test('authorization byte mutation fails',()=>withFixture({},x=>{
 fs.appendFileSync(x.af,' ');
 assert.match(check(x).errors.join(' '),/authorization file sha256 mismatch/);
}));
test('unapproved state fails closed',()=>withFixture({auth:{
 status:'PREPARED_NOT_AUTHORIZED',confirmatory_execution_authorized:false
}},x=>{
 assert.equal(check(x).valid,false);
}));
test('readiness independently blocks execution',()=>withFixture({readiness:{
 status:'BLOCKED_FINAL_AUTHORIZATION_ONLY',confirmatory_execution_authorized:false
}},x=>{
 assert.equal(check(x).valid,false);
}));
test('invalid frozen source SHA fails',()=>withFixture({auth:{
 git_blob_guards:{[guard]:'0'.repeat(40)}
}},x=>{
 assert.match(check(x).errors.join(' '),/authorization blob mismatch/);
}));
test('unfrozen LLM condition rejected',()=>withFixture({auth:{
 llm_replication:{enabled:true,models:[]}
}},x=>{
 assert.equal(check(x).valid,false);
}));
