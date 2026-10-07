import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentnessFirstPolicy } from './policy-currentness-first.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));

function surfaceVote(input){
  const scores=new Map(input.candidates.map(c=>[c.candidate_id,0]));
  for(const e of input.evidence){
    for(const id of e.supports_candidates??[]){
      if(scores.has(id)) scores.set(id,scores.get(id)+1);
    }
  }
  const winner=[...scores.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
  if(!winner||winner[1]<=0) return {decisive:false,action_family:'DEFER',selected_candidate_id:null};
  const c=input.candidates.find(x=>x.candidate_id===winner[0]);
  return {decisive:true,action_family:c.action_family,selected_candidate_id:c.candidate_id};
}

function actionKey(a){return a.action_family+'::'+String(a.selected_candidate_id??'');}
function allowed(world,action){
  return new Set(world.allowed_decisive_actions.map(actionKey)).has(actionKey(action));
}

export function evaluatePairedPolicies(file){
  const pairs=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const policies={
    SURFACE_VOTE:surfaceVote,
    CURRENTNESS_FIRST:input=>currentnessFirstPolicy(input)
  };
  const rows=[];
  for(const pair of pairs){
    for(const [policyName,policy] of Object.entries(policies)){
      const a=policy(pair.world_a.policy_input);
      const b=policy(pair.world_b.policy_input);
      rows.push({
        pair_id:pair.pair_id,
        policy:policyName,
        output_a:a,
        output_b:b,
        outputs_identical:JSON.stringify(a)===JSON.stringify(b),
        decisive_a:a.decisive===true,
        decisive_b:b.decisive===true,
        violation_a:a.decisive===true && !allowed(pair.world_a,a),
        violation_b:b.decisive===true && !allowed(pair.world_b,b)
      });
    }
  }
  const byPolicy={};
  for(const name of Object.keys(policies)){
    const rs=rows.filter(r=>r.policy===name);
    byPolicy[name]={
      pairs:rs.length,
      identical_output_pairs:rs.filter(r=>r.outputs_identical).length,
      both_decisive_pairs:rs.filter(r=>r.decisive_a&&r.decisive_b).length,
      pair_with_any_violation_count:rs.filter(r=>r.violation_a||r.violation_b).length,
      total_world_violations:rs.reduce((n,r)=>n+(r.violation_a?1:0)+(r.violation_b?1:0),0)
    };
  }
  return {schema_version:1,pairs:pairs.length,by_policy:byPolicy,rows};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=process.argv[2]??path.join(HERE,'dev/paired-world-toy.jsonl');
  const out=process.argv[3];
  const r=evaluatePairedPolicies(path.resolve(file));
  if(out) fs.writeFileSync(path.resolve(out),JSON.stringify(r,null,2)+'\n');
  console.log(JSON.stringify({pairs:r.pairs,by_policy:r.by_policy},null,2));
}
