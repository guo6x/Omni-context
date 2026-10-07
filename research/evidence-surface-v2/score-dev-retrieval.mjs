import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentnessFirstPolicy } from './policy-currentness-first.mjs';
import { surfaceVotePolicy } from './policy-surface-vote.mjs';

function actionKey(a){return a.action_family+'::'+String(a.selected_candidate_id??'');}
function allowed(t,a){return new Set(t.allowed_decisive_actions.map(actionKey)).has(actionKey(a));}
function readJsonl(file){return fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);}

function toEvidence(doc){
  return {
    evidence_id:doc.document_id,
    role:doc.role,
    fact:doc.fact,
    currentness:doc.currentness,
    supports_candidates:doc.supports_candidates,
    source_event_id:doc.source_event_id,
    at:doc.at??null
  };
}

export function scoreRetrieval(inputFile,truthFile,rankingFile){
  const inputs=readJsonl(inputFile);
  const truth=readJsonl(truthFile);
  const rankings=JSON.parse(fs.readFileSync(rankingFile,'utf8'));
  const I=new Map(inputs.map(x=>[x.case_id,x]));
  const T=new Map(truth.map(x=>[x.case_id,x]));
  if(I.size!==T.size)throw new Error('input/truth case count mismatch');
  for(const id of I.keys())if(!T.has(id))throw new Error('truth missing case '+id);

  const rows=[];
  for(const rr of rankings.rows){
    const input=I.get(rr.case_id),t=T.get(rr.case_id);
    if(!input||!t)throw new Error('ranking references unknown case '+rr.case_id);
    const byId=new Map(input.documents.map(d=>[d.document_id,d]));
    const docs=rr.document_ids.map(id=>byId.get(id));
    if(docs.some(x=>!x))throw new Error('ranking references unknown document in '+rr.case_id);
    const policyInput={candidates:input.candidates,evidence:docs.map(toEvidence),prior_state:input.prior_state};

    for(const [policy,fn] of Object.entries({
      SURFACE_VOTE:surfaceVotePolicy,
      CURRENTNESS_FIRST:currentnessFirstPolicy
    })){
      const a=fn(policyInput);
      rows.push({
        case_id:rr.case_id,pair_id:t.pair_id,member:t.member,family:t.family,
        retriever:rr.retriever,k:rr.k,policy,
        target_present:Boolean(t.target_document_id),
        target_hit:Boolean(t.target_document_id&&rr.document_ids.includes(t.target_document_id)),
        visible_base_recall:t.expected_visible_base_ids.filter(id=>rr.document_ids.includes(id)).length/t.expected_visible_base_ids.length,
        decisive:a.decisive===true,
        action:a,
        world_action_violation:a.decisive===true&&!allowed(t,a),
        correct_decisive:a.decisive===true&&allowed(t,a)
      });
    }
  }

  const groups={};
  for(const r of rows){
    const key=[r.retriever,'k'+r.k,r.policy].join('::');
    if(!groups[key])groups[key]=[];
    groups[key].push(r);
  }
  const summary={};
  for(const [key,rs] of Object.entries(groups)){
    const b=rs.filter(x=>x.member==='B');
    summary[key]={
      n:rs.length,
      b_n:b.length,
      b_target_hit_count:b.filter(x=>x.target_hit).length,
      b_target_recall:b.length?b.filter(x=>x.target_hit).length/b.length:null,
      decisive_count:rs.filter(x=>x.decisive).length,
      wavr_count:rs.filter(x=>x.world_action_violation).length,
      correct_decisive_count:rs.filter(x=>x.correct_decisive).length,
      mean_visible_base_recall:rs.reduce((a,x)=>a+x.visible_base_recall,0)/rs.length
    };
  }
  return {schema_version:2,rows,summary};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]||!process.argv[3]||!process.argv[4]){
    console.error('usage: node score-dev-retrieval.mjs <retriever-input.jsonl> <scoring-truth.jsonl> <rankings.json> [out.json]');
    process.exit(2);
  }
  const r=scoreRetrieval(path.resolve(process.argv[2]),path.resolve(process.argv[3]),path.resolve(process.argv[4]));
  if(process.argv[5])fs.writeFileSync(path.resolve(process.argv[5]),JSON.stringify(r,null,2)+'\n');
  console.log(JSON.stringify(r.summary,null,2));
}
