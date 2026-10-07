import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDevPairs } from './generate-dev-paired-worlds.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));

function targetEvidence(pair){
  const family=pair.family;
  const hidden=pair.world_b.hidden_state.hidden_events[0];
  const correct=pair.world_b.allowed_decisive_actions[0];
  const base={
    document_id:pair.pair_id+'-target',
    kind:'hidden_transition',
    is_target:true,
    source_event_id:hidden.event_id,
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
    document_id:pair.pair_id+'-visible-'+String(i+1),
    kind:'visible_base',
    is_target:false,
    evidence_id:e.evidence_id,
    source_event_id:e.source_event_id,
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

function distractors(pair){
  return DISTRACTOR_BUILDERS.map((fn,i)=>({
    document_id:pair.pair_id+'-distractor-'+String(i+1),
    kind:'distractor',
    is_target:false,
    source_event_id:pair.pair_id+'-distractor-src-'+String(i+1),
    role:'distractor',
    fact:fn(pair,i),
    currentness:'current',
    supports_candidates:[],
    at:null
  }));
}

export function generateDevRetrievalCases(){
  const pairs=generateDevPairs();
  const cases=[];
  for(const pair of pairs){
    const visible=visibleDocs(pair);
    const noise=distractors(pair);
    const target=targetEvidence(pair);
    for(const member of ['A','B']){
      const world=member==='A'?pair.world_a:pair.world_b;
      const docs=member==='A'?[...visible,...noise]:[...visible,target,...noise];
      cases.push({
        schema_version:'evidence-surface-v2-retrieval-dev-v0',
        case_id:pair.pair_id+'-'+member,
        pair_id:pair.pair_id,
        member,
        family:pair.family,
        domain_id:pair.construction_provenance.domain_id,
        query:pair.world_a.policy_input.question,
        candidates:pair.world_a.policy_input.candidates,
        prior_state:pair.world_a.policy_input.prior_state,
        documents:docs,
        target_document_id:member==='B'?target.document_id:null,
        allowed_decisive_actions:world.allowed_decisive_actions,
        expected_visible_base_ids:visible.map(x=>x.document_id),
        construction:{
          split:'dev',
          generator_version:'retrieval-dev-source-store-0.1',
          distractor_count:noise.length,
          target_present:member==='B'
        }
      });
    }
  }
  return cases;
}

export function writeDevRetrievalCases(file){
  const cases=generateDevRetrievalCases();
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,cases.map(x=>JSON.stringify(x)).join('\n')+'\n');
  return cases;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const out=process.argv[2]??path.join(HERE,'out-retrieval-dev/source-store.jsonl');
  const cases=writeDevRetrievalCases(path.resolve(out));
  console.log(JSON.stringify({
    status:'DEV_ONLY',
    cases:cases.length,
    b_cases:cases.filter(x=>x.member==='B').length,
    docs_a:[...new Set(cases.filter(x=>x.member==='A').map(x=>x.documents.length))],
    docs_b:[...new Set(cases.filter(x=>x.member==='B').map(x=>x.documents.length))],
    out:path.resolve(out)
  },null,2));
}
