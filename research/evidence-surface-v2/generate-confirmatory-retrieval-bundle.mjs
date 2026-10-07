import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const TOKEN_RE=/[a-z0-9]+/g;
export const GENERATOR_VERSION='confirmatory-retrieval-bundle-0.1';

function readJsonl(file){return fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}
function tokenize(text){return text.toLowerCase().match(TOKEN_RE)??[];}
function opaque(prefix,value){return prefix+'-'+crypto.createHash('sha256').update(value).digest('hex').slice(0,16);}
function docId(pair,index){return opaque('doc','confirmatory|'+pair.pair_id+'|doc|'+index);}
function sourceId(pair,index){return opaque('src','confirmatory|'+pair.pair_id+'|src|'+index);}
function caseId(pair,member){return opaque('case','confirmatory|'+pair.pair_id+'|member|'+member);}

function matchedControlFact(pair,targetFact){
  const n=tokenize(targetFact).length;
  const seed=('registry housekeeping entry for '+pair.construction_provenance.domain_id+' records an unrelated completed operation and leaves the current decision unchanged').toLowerCase().match(TOKEN_RE)??[];
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
  (p,i)=>'Index maintenance bulletin '+(i+1)+' for '+p.construction_provenance.domain_id+' reports successful catalog synchronization without changing the active decision.',
  (p,i)=>'Routing ledger entry '+(i+1)+' references the same operational topic for filing purposes and creates no new instruction, permission, constraint, outcome, or resolution.',
  (p,i)=>'Historical operations memo '+(i+1)+' describes a completed predecessor task and has no authority over the present action.',
  (p,i)=>'Service observation '+(i+1)+' records routine health information for the associated entity without modifying the governing decision state.',
  (p,i)=>'Ownership metadata note '+(i+1)+' updates administrative responsibility only and does not alter the current action.',
  (p,i)=>'Terminology reference '+(i+1)+' defines words used in the domain while leaving all present requirements and plans unchanged.',
  (p,i)=>'Archive catalog record '+(i+1)+' points to an unrelated prior event involving the entity and is not a superseding record.',
  (p,i)=>'Telemetry digest '+(i+1)+' contains ordinary measurements and explicitly introduces no decision-changing transition.'
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

export function generateConfirmatoryRetrievalBundle(pairs){
  const inputs=[],truth=[];
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
        ledger_profile:pair.construction_provenance.ledger_profile,
        target_document_id:member==='B'?target.document_id:null,
        transition_slot_document_id:target.document_id,
        allowed_decisive_actions:world.allowed_decisive_actions,
        expected_visible_base_ids:visible.map(x=>x.document_id),
        construction:{
          split:'confirmatory',
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

export function writeConfirmatoryRetrievalBundle(pairFile,inputFile,truthFile){
  const pairs=readJsonl(pairFile);
  const bundle=generateConfirmatoryRetrievalBundle(pairs);
  fs.mkdirSync(path.dirname(inputFile),{recursive:true});
  fs.mkdirSync(path.dirname(truthFile),{recursive:true});
  fs.writeFileSync(inputFile,bundle.inputs.map(x=>JSON.stringify(x)).join('\n')+'\n');
  fs.writeFileSync(truthFile,bundle.truth.map(x=>JSON.stringify(x)).join('\n')+'\n');
  return bundle;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const pairFile=path.resolve(process.argv[2]??path.join(HERE,'confirmatory/frozen/paired-worlds.jsonl'));
  const inputFile=path.resolve(process.argv[3]??path.join(HERE,'out-confirmatory-retrieval/retriever-input.jsonl'));
  const truthFile=path.resolve(process.argv[4]??path.join(HERE,'out-confirmatory-retrieval/scoring-truth.jsonl'));
  const {inputs,truth}=writeConfirmatoryRetrievalBundle(pairFile,inputFile,truthFile);
  console.log(JSON.stringify({
    status:'CONSTRUCTION_ONLY__NO_RETRIEVAL_OUTCOMES',
    generator_version:GENERATOR_VERSION,
    cases:inputs.length,
    pairs:new Set(truth.map(x=>x.pair_id)).size,
    input_file:inputFile,
    truth_file:truthFile
  },null,2));
}
