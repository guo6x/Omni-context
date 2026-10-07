import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentnessFirstPolicy } from './policy-currentness-first.mjs';

function actionKey(a){return a.action_family+'::'+String(a.selected_candidate_id??'');}
function allowed(c,a){return new Set(c.allowed_decisive_actions.map(actionKey)).has(actionKey(a));}

function surfaceVote(input){
  const score=new Map(input.candidates.map(c=>[c.candidate_id,0]));
  for(const e of input.evidence){
    for(const id of e.supports_candidates??[]) if(score.has(id))score.set(id,score.get(id)+1);
  }
  const w=[...score.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
  if(!w||w[1]<=0)return {decisive:false,action_family:'DEFER',selected_candidate_id:null};
  const c=input.candidates.find(x=>x.candidate_id===w[0]);
  return {decisive:true,action_family:c.action_family,selected_candidate_id:c.candidate_id};
}

function toEvidence(doc){
  return {
    evidence_id:doc.document_id,
    role:doc.role,
    fact:doc.fact,
    currentness:doc.currentness,
    supports_candidates:doc.supports_candidates,
    source_event_id:doc.source_event_id
  };
}

export function scoreRetrieval(sourceFile,rankingFile){
  const cases=fs.readFileSync(sourceFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const rankings=JSON.parse(fs.readFileSync(rankingFile,'utf8'));
  const C=new Map(cases.map(x=>[x.case_id,x]));
  const rows=[];
  for(const rr of rankings.rows){
    const c=C.get(rr.case_id);
    if(!c)throw new Error('ranking references unknown case '+rr.case_id);
    const byId=new Map(c.documents.map(d=>[d.document_id,d]));
    const docs=rr.document_ids.map(id=>byId.get(id));
    if(docs.some(x=>!x))throw new Error('ranking references unknown document in '+rr.case_id);
    const input={candidates:c.candidates,evidence:docs.map(toEvidence),prior_state:c.prior_state};
    for(const [policy,fn] of Object.entries({
      SURFACE_VOTE:surfaceVote,
      CURRENTNESS_FIRST:currentnessFirstPolicy
    })){
      const a=fn(input);
      rows.push({
        case_id:c.case_id,pair_id:c.pair_id,member:c.member,family:c.family,
        retriever:rr.retriever,k:rr.k,policy,
        target_present:Boolean(c.target_document_id),
        target_hit:Boolean(c.target_document_id&&rr.document_ids.includes(c.target_document_id)),
        visible_base_recall:c.expected_visible_base_ids.filter(id=>rr.document_ids.includes(id)).length/c.expected_visible_base_ids.length,
        decisive:a.decisive===true,
        action:a,
        world_action_violation:a.decisive===true&&!allowed(c,a),
        correct_decisive:a.decisive===true&&allowed(c,a)
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
      b_target_recall:b.filter(x=>x.target_hit).length/b.length,
      decisive_count:rs.filter(x=>x.decisive).length,
      wavr_count:rs.filter(x=>x.world_action_violation).length,
      correct_decisive_count:rs.filter(x=>x.correct_decisive).length,
      mean_visible_base_recall:rs.reduce((a,x)=>a+x.visible_base_recall,0)/rs.length
    };
  }
  return {schema_version:1,rows,summary};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]||!process.argv[3]){console.error('usage: node score-dev-retrieval.mjs <source.jsonl> <rankings.json> [out.json]');process.exit(2);}
  const r=scoreRetrieval(path.resolve(process.argv[2]),path.resolve(process.argv[3]));
  if(process.argv[4])fs.writeFileSync(path.resolve(process.argv[4]),JSON.stringify(r,null,2)+'\n');
  console.log(JSON.stringify(r.summary,null,2));
}
