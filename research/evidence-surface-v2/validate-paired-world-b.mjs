import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

function ordered(value){
  if(Array.isArray(value)) return value.map(ordered);
  if(value!==null && typeof value==='object'){
    const out={};
    for(const k of Object.keys(value).sort()) out[k]=ordered(value[k]);
    return out;
  }
  return value;
}
function stable(value){return JSON.stringify(ordered(value));}
function akey(a){return String(a.action_family)+'\u0000'+String(a.selected_candidate_id??'');}
function walkKeys(value,found=[]){
  if(Array.isArray(value)){for(const v of value) walkKeys(v,found);return found;}
  if(value!==null && typeof value==='object'){
    for(const [k,v] of Object.entries(value)){
      if(/^(world_truth|hidden_state|allowed_decisive_actions|pair_member|transition_exists|gold|coverage_complete|correct_action)$/i.test(k)) found.push(k);
      walkKeys(v,found);
    }
  }
  return found;
}

export function validatePairB(pair){
  const failures=[];
  try{assert.deepEqual(ordered(pair.world_a.policy_input),ordered(pair.world_b.policy_input));}
  catch{failures.push('POLICY_INPUT_NOT_EQUAL');}

  const a=new Set((pair.world_a.allowed_decisive_actions??[]).map(akey));
  const b=new Set((pair.world_b.allowed_decisive_actions??[]).map(akey));
  if(a.size===0||b.size===0) failures.push('EMPTY_ALLOWED_ACTION_SET');
  if([...a].some(x=>b.has(x))) failures.push('DECISIVE_ACTION_OVERLAP');

  for(const side of ['world_a','world_b']){
    const nonCurrent=(pair[side]?.policy_input?.evidence??[]).filter(e=>e.currentness!=='current');
    if(nonCurrent.length) failures.push(side.toUpperCase()+'_NONCURRENT_VISIBLE_EVIDENCE');
  }

  const forbidden=[...walkKeys(pair.world_a.policy_input),...walkKeys(pair.world_b.policy_input)];
  if(forbidden.length) failures.push('FORBIDDEN_POLICY_KEY');

  for(const side of ['world_a','world_b']){
    const w=pair[side];
    const hidden=new Set((w.hidden_state?.hidden_events??[]).map(x=>x.event_id));
    const visible=new Set((w.policy_input?.evidence??[]).map(x=>x.source_event_id));
    if([...hidden].some(x=>visible.has(x))) failures.push(side.toUpperCase()+'_HIDDEN_EVENT_ID_VISIBLE');
    const ctx=w.acquisition_context;
    if(!ctx||!Array.isArray(ctx.required_channels)||!Array.isArray(ctx.channels)) failures.push(side.toUpperCase()+'_BAD_ACQUISITION_CONTEXT');
    else{
      for(const req of ctx.required_channels){
        if(ctx.channels.filter(x=>x.channel_id===req).length!==1) failures.push(side.toUpperCase()+'_REQUIRED_CHANNEL_CARDINALITY');
      }
      if(ctx.channels.some(x=>x.retrieved_head_seq>x.source_head_seq)) failures.push(side.toUpperCase()+'_IMPOSSIBLE_HEAD_ORDER');
    }
  }

  if(pair.world_a.hidden_state?.surface_complete_truth===pair.world_b.hidden_state?.surface_complete_truth) failures.push('COMPLETENESS_TRUTH_NOT_DIFFERENT');

  return {
    pair_id:pair.pair_id,
    valid:failures.length===0,
    failures,
    stable_policy_input_a:stable(pair.world_a.policy_input),
    stable_policy_input_b:stable(pair.world_b.policy_input),
    exact_equal:stable(pair.world_a.policy_input)===stable(pair.world_b.policy_input),
    decisive_disjoint:![...a].some(x=>b.has(x))
  };
}

export function validateFileB(file){
  const pairs=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const results=pairs.map(validatePairB);
  return {schema_version:1,validator:'B-independent',pairs:results.length,valid_pairs:results.filter(x=>x.valid).length,all_valid:results.every(x=>x.valid),results};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=validateFileB(path.resolve(process.argv[2]));
  if(process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(!report.all_valid) process.exit(1);
}
