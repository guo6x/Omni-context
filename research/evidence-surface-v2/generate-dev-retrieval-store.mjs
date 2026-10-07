import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateDevPairs } from './generate-dev-paired-worlds.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const TOKEN_RE=/[a-z0-9]+/g;
const GENERATOR_VERSION='retrieval-dev-source-store-0.3';

function tokenize(text){return text.toLowerCase().match(TOKEN_RE)??[];}
function opaque(prefix,value){
  return prefix+'-'+crypto.createHash('sha256').update(value).digest('hex').slice(0,16);
}
function docId(pair,index){return opaque('doc',pair.pair_id+'|doc|'+index);}
function sourceId(pair,index){return opaque('src',pair.pair_id+'|src|'+index);}
function caseId(pair,member){return opaque('case',pair.pair_id+'|member|'+member);}

function matchedControlFact(pair,targetFact){
  const n=tokenize(targetFact).length;
  const seed=('routine archival metadata record for '+pair.construction_provenance.domain_id+' documents an unrelated historical operation with no change to the present decision state').toLowerCase().match(TOKEN_RE)??[];
  const out=[];
  for(let i=0;i<n;i++)out.push(seed[i%seed.length]);
  return out.join(' ');
}

function targetEvidence(pair){
  const family=pair.family;
  const hidden=pair.world_b.hidden_state.hidden_events[0];
  const correct=pair.world_b.allowed_decisive_actions[0];
  const base={
    document_id:docId(pair,3),
    source_event_id:sourceId(pair,3),
    currentness:'current',
    supports_candidates:[correct.selected_candidate_id],
    fact:hidden.statement,
    at:hidden.at
  };
  if(family==='REVOCATION'||family==='AUTHORITY_WITHDRAWAL') return {...base,role:'override'};
  if(family==='CONSTRAINT_CHANGE') return {...base,role:'current_fact'};
  if(family==='OUTCOME_REVISION') return {...base,role:'outcome'};
  return {...base,role:'conflict_resolution'};
}

function visibleDocs(pair){
  const hiddenAt=new Date(pair.world_b.hidden_state.hidden_events[0].at).getTime();
  return pair.world_a.policy_input.evidence.map((e,i)=>({
    document_id:docId(pair,i+1),
    source_event_id:sourceId(pair,i+1),
    role:e.role,
    fact:e.fact,
    currentness:e.currentness,
    supports_candidates:e.supports_candidates,
    at:new Date(hiddenAt-(pair.world_a.policy_input.evidence.length-i)*3600_000).toISOString()
  }));
}

const DISTRACTOR_BUILDERS=[
  (p,i)=>'Routine audit note '+(i+1)+' for '+p.construction_provenance.domain_id+' confirms that the workflow metadata was indexed successfully but does not alter the decision.',
  (p,i)=>'Operational status bulletin '+(i+1)+' mentions '+p.world_a.policy_input.question.replace(/[?]$/,'')+' as a tracked topic, without issuing any new instruction or authorization.',
  (p,i)=>'Historical reference '+(i+1)+' describes an earlier completed task in the same domain and is not a revision of the current decision state.',
  (p,i)=>'Monitoring record '+(i+1)+' reports normal service health for the associated system and contains no decision-changing transition.',
  (p,i)=>'Administrative note '+(i+1)+' records ownership and routing metadata for this task but does not revoke, approve, revise, or resolve the current action.',
  (p,i)=>'Background context '+(i+1)+' summarizes the domain terminology used by the current task without changing any requirement or plan.',
  (p,i)=>'Archive entry '+(i+1)+' references the same entity for an unrelated past operation and has no authority over the present decision.',
  (p,i)=>'Telemetry summary '+(i+1)+' reports routine measurements for the entity while explicitly containing no new decision instruction.'
];

function matchedControl(pair,target){
  return {
    document_id:target.document_id,
    source_event_id:target.source_event_id,
    role:'distractor',
    fact:matchedControlFact(pair,target.fact),
    currentness:'current',
    supports_candidates:[],
    at:target.at
  };
}

function distractors(pair){
  return DISTRACTOR_BUILDERS.map((fn,i)=>({
    document_id:docId(pair,i+4),
    source_event_id:sourceId(pair,i+4),
    role:'distractor',
    fact:fn(pair,i),
    currentness:'current',
    supports_candidates:[],
    at:null
  }));
}

export function generateDevRetrievalBundle(){
  const pairs=generateDevPairs();
  const inputs=[];
  const truth=[];
  for(const pair of pairs){
    const visible=visibleDocs(pair);
    const noise=distractors(pair);
    const target=targetEvidence(pair);
    const control=matchedControl(pair,target);
    for(const member of ['A','B']){
      const world=member==='A'?pair.world_a:pair.world_b;
      const documents=member==='A'?[...visible,control,...noise]:[...visible,target,...noise];
      const cid=caseId(pair,member);
      inputs.push({
        schema_version:'evidence-surface-v2-retrieval-input-v1',
        case_id:cid,
        query:pair.world_a.policy_input.question,
        candidates:pair.world_a.policy_input.candidates,
        prior_state:pair.world_a.policy_input.prior_state,
        documents
      });
      truth.push({
        schema_version:'evidence-surface-v2-retrieval-truth-v1',
        case_id:cid,
        pair_id:pair.pair_id,
        member,
        family:pair.family,
        domain_id:pair.construction_provenance.domain_id,
        target_document_id:member==='B'?target.document_id:null,
        transition_slot_document_id:target.document_id,
        allowed_decisive_actions:world.allowed_decisive_actions,
        expected_visible_base_ids:visible.map(x=>x.document_id),
        construction:{
          split:'dev',
          generator_version:GENERATOR_VERSION,
          distractor_count:noise.length,
          target_present:member==='B',
          matched_slot:true,
          transition_slot_token_count:tokenize(target.fact).length
        }
      });
    }
  }
  return {inputs,truth};
}

export function writeDevRetrievalBundle(inputFile,truthFile){
  const bundle=generateDevRetrievalBundle();
  fs.mkdirSync(path.dirname(inputFile),{recursive:true});
  fs.mkdirSync(path.dirname(truthFile),{recursive:true});
  fs.writeFileSync(inputFile,bundle.inputs.map(x=>JSON.stringify(x)).join('\n')+'\n');
  fs.writeFileSync(truthFile,bundle.truth.map(x=>JSON.stringify(x)).join('\n')+'\n');
  return bundle;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const inputFile=path.resolve(process.argv[2]??path.join(HERE,'out-retrieval-dev/retriever-input.jsonl'));
  const truthFile=path.resolve(process.argv[3]??path.join(HERE,'out-retrieval-dev/scoring-truth.jsonl'));
  const {inputs,truth}=writeDevRetrievalBundle(inputFile,truthFile);
  const byTruth=new Map(truth.map(x=>[x.case_id,x]));
  const docsA=inputs.filter(x=>byTruth.get(x.case_id).member==='A').map(x=>x.documents.length);
  const docsB=inputs.filter(x=>byTruth.get(x.case_id).member==='B').map(x=>x.documents.length);
  console.log(JSON.stringify({
    status:'DEV_ONLY',
    cases:inputs.length,
    b_cases:truth.filter(x=>x.member==='B').length,
    docs_a:[...new Set(docsA)],
    docs_b:[...new Set(docsB)],
    input_file:inputFile,
    truth_file:truthFile
  },null,2));
}
