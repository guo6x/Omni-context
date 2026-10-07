import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquisitionLedgerMonitor, surfaceOnlyMonitor } from './monitor-acquisition-ledger.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));

function actionKey(a){return a.action_family+'::'+String(a.selected_candidate_id??'');}
function isAllowed(world,action){
  const allowed=new Set(world.allowed_decisive_actions.map(actionKey));
  return allowed.has(actionKey(action));
}
function surfacePolicy(input){
  const scores=new Map(input.candidates.map(c=>[c.candidate_id,0]));
  for(const e of input.evidence){
    for(const id of e.supports_candidates??[]){
      if(scores.has(id)) scores.set(id,scores.get(id)+1);
    }
  }
  const winner=[...scores.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
  if(!winner||winner[1]<=0) return {decisive:false,action_family:'CLARIFY',selected_candidate_id:null};
  const c=input.candidates.find(x=>x.candidate_id===winner[0]);
  return {decisive:true,action_family:c.action_family,selected_candidate_id:c.candidate_id};
}
function defer(){return {decisive:false,action_family:'DEFER',selected_candidate_id:null};}

function runCondition(name,world){
  if(name==='M0_NO_MONITOR') return {monitor_status:null,action:surfacePolicy(world.policy_input)};
  if(name==='M1_ALWAYS_DEFER') return {monitor_status:'INCOMPLETE',action:defer()};
  if(name==='M2_SURFACE_ONLY'){
    const m=surfaceOnlyMonitor(world.policy_input);
    return {monitor_status:m.status,monitor_reasons:m.reasons,action:m.status==='COMPLETE'?surfacePolicy(world.policy_input):defer()};
  }
  if(name==='M3_ACQUISITION_LEDGER'){
    const m=acquisitionLedgerMonitor(world.acquisition_context);
    return {monitor_status:m.status,monitor_reasons:m.reasons,action:m.status==='COMPLETE'?surfacePolicy(world.policy_input):defer()};
  }
  if(name==='M4_ORACLE'){
    const complete=world.hidden_state.surface_complete_truth===true;
    return {monitor_status:complete?'COMPLETE':'INCOMPLETE',action:complete?surfacePolicy(world.policy_input):defer()};
  }
  throw Error('unknown condition '+name);
}

export function runDev(file){
  const pairs=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const conditions=['M0_NO_MONITOR','M1_ALWAYS_DEFER','M2_SURFACE_ONLY','M3_ACQUISITION_LEDGER','M4_ORACLE'];
  const rows=[];
  for(const pair of pairs){
    for(const member of ['world_a','world_b']){
      const world=pair[member];
      for(const condition of conditions){
        const out=runCondition(condition,world);
        const truth=world.hidden_state.surface_complete_truth;
        rows.push({
          pair_id:pair.pair_id,member,condition,
          truth_complete:truth,
          monitor_status:out.monitor_status,
          action:out.action,
          decisive:out.action.decisive,
          world_action_violation:out.action.decisive&&!isAllowed(world,out.action),
          correct_decisive:out.action.decisive&&isAllowed(world,out.action),
          false_complete:out.monitor_status==='COMPLETE'&&!truth,
          false_incomplete:out.monitor_status==='INCOMPLETE'&&truth
        });
      }
    }
  }
  const byCondition={};
  for(const condition of conditions){
    const rs=rows.filter(r=>r.condition===condition);
    const pairViolation=pairs.filter(p=>rs.filter(r=>r.pair_id===p.pair_id).some(r=>r.world_action_violation)).length;
    byCondition[condition]={
      n:rs.length,
      decisive_count:rs.filter(r=>r.decisive).length,
      completion_rate:rs.filter(r=>r.decisive).length/rs.length,
      wavr_count:rs.filter(r=>r.world_action_violation).length,
      wavr:rs.filter(r=>r.world_action_violation).length/rs.length,
      correct_decisive_count:rs.filter(r=>r.correct_decisive).length,
      false_complete_count:rs.filter(r=>r.false_complete).length,
      false_incomplete_count:rs.filter(r=>r.false_incomplete).length,
      pair_with_any_violation_count:pairViolation
    };
  }
  return {schema_version:1,pairs:pairs.length,worlds:pairs.length*2,conditions,by_condition:byCondition,rows};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=process.argv[2]??path.join(HERE,'dev/paired-world-toy.jsonl');
  const out=process.argv[3];
  const r=runDev(path.resolve(file));
  if(out) fs.writeFileSync(path.resolve(out),JSON.stringify(r,null,2)+'\n');
  console.log(JSON.stringify({pairs:r.pairs,by_condition:r.by_condition},null,2));
}
