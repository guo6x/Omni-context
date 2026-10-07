import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

function readJsonl(file){return fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function stable(x){
  if(Array.isArray(x))return '['+x.map(stable).join(',')+']';
  if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
  return JSON.stringify(x);
}
function tokenize(text){return text.toLowerCase().match(/[a-z0-9]+/g)??[];}
function count(xs,fn){const m={};for(const x of xs){const k=fn(x);m[k]=(m[k]??0)+1;}return Object.fromEntries(Object.entries(m).sort());}

const FORBIDDEN=new Set([
  'pair_id','member','family','domain_id','ledger_profile','target_document_id',
  'transition_slot_document_id','allowed_decisive_actions','expected_visible_base_ids',
  'is_target','surface_complete_truth','construction','world_action_violation',
  'correct_decisive','policy_output','model_response','llm_output'
]);

function forbiddenHits(x,p='root',hits=[]){
  if(Array.isArray(x)){x.forEach((v,i)=>forbiddenHits(v,p+'['+i+']',hits));return hits;}
  if(x&&typeof x==='object'){
    for(const [k,v] of Object.entries(x)){
      if(FORBIDDEN.has(k))hits.push(p+'.'+k);
      forbiddenHits(v,p+'.'+k,hits);
    }
  }
  return hits;
}

export function auditConfirmatoryRetrieval(inputFile,truthFile){
  const inputs=readJsonl(inputFile),truth=readJsonl(truthFile);
  const I=new Map(inputs.map(x=>[x.case_id,x]));
  const T=new Map(truth.map(x=>[x.case_id,x]));
  const byPair=new Map();
  for(const t of truth){
    if(!byPair.has(t.pair_id))byPair.set(t.pair_id,{});
    byPair.get(t.pair_id)[t.member]={truth:t,input:I.get(t.case_id)};
  }

  const errors=[];
  const forbidden=[];
  for(const x of inputs)forbidden.push(...forbiddenHits(x,x.case_id));

  for(const [pairId,ab] of byPair){
    if(!ab.A||!ab.B){errors.push(pairId+': missing A/B');continue;}
    const A=ab.A,B=ab.B;
    if(!A.input||!B.input){errors.push(pairId+': missing retriever input');continue;}
    if(A.input.documents.length!==11||B.input.documents.length!==11)errors.push(pairId+': document count != 11');
    const aIds=A.input.documents.map(x=>x.document_id),bIds=B.input.documents.map(x=>x.document_id);
    if(stable(aIds)!==stable(bIds))errors.push(pairId+': document id order differs');
    if(stable(A.input.candidates)!==stable(B.input.candidates)||stable(A.input.prior_state)!==stable(B.input.prior_state)||A.input.query!==B.input.query){
      errors.push(pairId+': paired query/candidate/prior-state mismatch');
    }
    const slot=A.truth.transition_slot_document_id;
    if(slot!==B.truth.transition_slot_document_id||B.truth.target_document_id!==slot||A.truth.target_document_id!==null){
      errors.push(pairId+': truth slot binding invalid');
    }
    const aBy=new Map(A.input.documents.map(x=>[x.document_id,x]));
    const bBy=new Map(B.input.documents.map(x=>[x.document_id,x]));
    for(const id of aIds){
      const a=aBy.get(id),b=bBy.get(id);
      if(!/^doc-[a-f0-9]{16}$/.test(id))errors.push(pairId+': non-opaque document id '+id);
      if(!/^src-[a-f0-9]{16}$/.test(a.source_event_id)||!/^src-[a-f0-9]{16}$/.test(b.source_event_id))errors.push(pairId+': non-opaque source id');
      if(/target|hidden|visible|distractor|transition/i.test(id+a.source_event_id+b.source_event_id))errors.push(pairId+': semantic token in opaque id');
      if(id===slot){
        if(a.role!=='distractor'||(a.supports_candidates??[]).length!==0)errors.push(pairId+': A slot is not neutral');
        if(stable(a)===stable(b))errors.push(pairId+': A/B slot unexpectedly identical');
        if(tokenize(a.fact).length!==tokenize(b.fact).length)errors.push(pairId+': slot token lengths differ');
        if(a.at!==b.at)errors.push(pairId+': slot timestamps differ');
      }else if(stable(a)!==stable(b)){
        errors.push(pairId+': non-slot document differs '+id);
      }
    }
  }

  const family=count(truth.filter(x=>x.member==='A'),x=>x.family);
  const profile=count(truth.filter(x=>x.member==='A'),x=>x.ledger_profile);
  const domain=count(truth.filter(x=>x.member==='A'),x=>x.domain_id);
  const gates={
    input_cases_320:inputs.length===320,
    truth_cases_320:truth.length===320,
    unique_case_ids:new Set(inputs.map(x=>x.case_id)).size===320&&new Set(truth.map(x=>x.case_id)).size===320,
    one_to_one_case_join:I.size===T.size&&[...I.keys()].every(k=>T.has(k)),
    pairs_160:byPair.size===160,
    five_families_32_pairs_each:Object.keys(family).length===5&&Object.values(family).every(n=>n===32),
    four_profiles_40_pairs_each:Object.keys(profile).length===4&&Object.values(profile).every(n=>n===40),
    sixteen_domains_10_pairs_each:Object.keys(domain).length===16&&Object.values(domain).every(n=>n===10),
    no_truth_fields_in_retriever_input:forbidden.length===0,
    matched_pair_store_contract:errors.length===0
  };
  return {
    schema_version:1,
    status:Object.values(gates).every(Boolean)?'PASS':'FAIL',
    purpose:'confirmatory retrieval construction audit only; ranking and downstream outcomes are embargoed',
    retriever_input_sha256:sha(inputFile),
    scoring_truth_sha256:sha(truthFile),
    input_cases:inputs.length,
    truth_cases:truth.length,
    pairs:byPair.size,
    family_counts:family,
    ledger_profile_counts:profile,
    domain_counts:domain,
    forbidden_input_hits:forbidden,
    errors,
    gates
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]||!process.argv[3]){console.error('usage: node audit-confirmatory-retrieval-bundle.mjs <input.jsonl> <truth.jsonl> [out.json]');process.exit(2);}
  const r=auditConfirmatoryRetrieval(path.resolve(process.argv[2]),path.resolve(process.argv[3]));
  if(process.argv[4])fs.writeFileSync(path.resolve(process.argv[4]),JSON.stringify(r,null,2)+'\n');
  console.log(JSON.stringify(r,null,2));
  if(r.status!=='PASS')process.exit(1);
}
