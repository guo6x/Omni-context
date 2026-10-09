import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateJsonDocument } from './validate-json-document-schema.mjs';

function sha256File(file){
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function validateExecutionAuthorization({
  requestFile,
  authorizationFile,
  readinessFile,
  corpusFile,
  authorizationSchemaFile,
  requestSchemaFile,
  repoRoot=process.cwd()
}){
  const errors=[];
  const reqValidation=validateJsonDocument(requestSchemaFile,requestFile);
  const authValidation=validateJsonDocument(authorizationSchemaFile,authorizationFile);
  if(!reqValidation.valid)errors.push(...reqValidation.errors.map(x=>'request '+x));
  if(!authValidation.valid)errors.push(...authValidation.errors.map(x=>'authorization '+x));
  if(errors.length)return {valid:false,errors};

  const req=JSON.parse(fs.readFileSync(requestFile,'utf8'));
  const auth=JSON.parse(fs.readFileSync(authorizationFile,'utf8'));
  const readiness=JSON.parse(fs.readFileSync(readinessFile,'utf8'));

  if(req.authorization_id!==auth.authorization_id)errors.push('authorization id mismatch');
  const actualAuthSha=sha256File(authorizationFile);
  if(req.authorization_sha256!==actualAuthSha)errors.push('authorization file sha256 mismatch');

  if(auth.status!=='AUTHORIZED')errors.push('authorization status is not AUTHORIZED');
  if(auth.confirmatory_execution_authorized!==true)errors.push('authorization flag is not true');
  if(readiness.confirmatory_execution_authorized!==true)errors.push('readiness is not authorized');
  if(readiness.status!=='AUTHORIZED')errors.push('readiness status is not AUTHORIZED');
  if(auth.llm_replication?.enabled!==false)errors.push('LLM replication must remain disabled');
  if((auth.llm_replication?.models??[]).length!==0)errors.push('LLM model list must remain empty');

  const corpusSha=sha256File(corpusFile);
  if(corpusSha!==auth.frozen_corpus_sha256)errors.push('frozen corpus hash mismatch');

  const mandatorySnapshot='research/evidence-surface-v2/EXECUTION_PREREGISTRATION_SNAPSHOT.json';
  if(auth.preregistration_snapshot.path!==mandatorySnapshot){
    errors.push('preregistration snapshot must be the frozen execution snapshot');
  }
  const guardRecords=[
    ['research/evidence-surface-v2/EXECUTION_SOURCE_FREEZE.json',
     'EXECUTION_SOURCES_FROZEN__EXECUTION_NOT_AUTHORIZED'],
    ['research/evidence-surface-v2/RETRIEVAL_EXECUTION_SOURCE_FREEZE.json',
     'RETRIEVAL_EXECUTION_SOURCES_FROZEN__OUTCOMES_NOT_AUTHORIZED'],
    ['research/evidence-surface-v2/confirmatory/retrieval-construction/FREEZE_RECORD.json',
     'RETRIEVAL_CONSTRUCTION_FROZEN__OUTCOMES_NOT_AUTHORIZED']
  ];
  const requiredGuardPaths=new Set([
    mandatorySnapshot,
    'research/evidence-surface-v2/EXECUTION_MATRIX.json',
    'research/evidence-surface-v2/EXECUTION_READINESS.json',
    'research/evidence-surface-v2/execution-authorization.schema.json',
    'research/evidence-surface-v2/execution-request.schema.json',
    'research/evidence-surface-v2/validate-execution-authorization.mjs',
    '.github/workflows/research-evidence-v2-confirmatory-execution.yml'
  ]);
  for(const [rel,expectedStatus] of guardRecords){
    requiredGuardPaths.add(rel);
    const file=path.resolve(repoRoot,rel);
    if(!fs.existsSync(file)){errors.push('frozen guard record missing: '+rel);continue;}
    const record=JSON.parse(fs.readFileSync(file,'utf8'));
    if(record.status!==expectedStatus)errors.push('bad frozen record status: '+rel);
    for(const [k,v] of Object.entries(record.declarations??{})){
      if(v!==false)errors.push('frozen record outcome embargo violated: '+rel+':'+k);
    }
    for(const [p,expected] of Object.entries(record.git_blob_guards??{})){
      requiredGuardPaths.add(p);
      if(auth.git_blob_guards?.[p]!==expected){
        errors.push('authorization does not match frozen source guard: '+p);
      }
    }
  }
  for(const p of requiredGuardPaths){
    if(!Object.prototype.hasOwnProperty.call(auth.git_blob_guards??{},p)){
      errors.push('authorization missing required source guard: '+p);
    }
  }
  const snapPath=path.resolve(repoRoot,auth.preregistration_snapshot.path);
  if(!fs.existsSync(snapPath))errors.push('preregistration snapshot missing');
  else if(sha256File(snapPath)!==auth.preregistration_snapshot.sha256)errors.push('preregistration snapshot sha256 mismatch');

  for(const [p,expected] of Object.entries(auth.git_blob_guards??{})){
    const full=path.resolve(repoRoot,p);
    if(!fs.existsSync(full)){errors.push('guarded path missing: '+p);continue;}
    let actual;
    try{
      actual=cp.execFileSync('git',['hash-object',p],{cwd:repoRoot,encoding:'utf8'}).trim();
    }catch(e){
      errors.push('git hash-object failed: '+p);
      continue;
    }
    if(actual!==expected)errors.push('authorization blob mismatch: '+p);
  }

  return {
    valid:errors.length===0,
    errors,
    authorization_id:auth.authorization_id,
    authorization_sha256:actualAuthSha,
    frozen_corpus_sha256:corpusSha
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [requestFile,authorizationFile,readinessFile,corpusFile]=process.argv.slice(2);
  if(!requestFile||!authorizationFile||!readinessFile||!corpusFile){
    console.error('usage: node validate-execution-authorization.mjs <request.json> <authorization.json> <readiness.json> <corpus.jsonl>');
    process.exit(2);
  }
  const HERE=path.dirname(fileURLToPath(import.meta.url));
  const r=validateExecutionAuthorization({
    requestFile:path.resolve(requestFile),
    authorizationFile:path.resolve(authorizationFile),
    readinessFile:path.resolve(readinessFile),
    corpusFile:path.resolve(corpusFile),
    authorizationSchemaFile:path.join(HERE,'execution-authorization.schema.json'),
    requestSchemaFile:path.join(HERE,'execution-request.schema.json'),
    repoRoot:path.resolve(HERE,'../..')
  });
  console.log(JSON.stringify(r,null,2));
  if(!r.valid)process.exit(1);
}
