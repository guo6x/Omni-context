import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const FORBIDDEN_POLICY_KEYS=new Set([
  'world_truth','hidden_state','allowed_decisive_actions','pair_member',
  'transition_exists','gold','coverage_complete','correct_action'
]);

function canonical(x){
  if(Array.isArray(x)) return x.map(canonical);
  if(x && typeof x==='object'){
    return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));
  }
  return x;
}
function canonString(x){ return JSON.stringify(canonical(x)); }
function hash(x){ return crypto.createHash('sha256').update(canonString(x)).digest('hex'); }
function actionKey(a){ return a.action_family+'::'+String(a.selected_candidate_id??''); }

function scanForbidden(x,pathSoFar='policy_input'){
  const hits=[];
  if(Array.isArray(x)){
    x.forEach((v,i)=>hits.push(...scanForbidden(v,pathSoFar+'['+i+']')));
  } else if(x && typeof x==='object'){
    for(const [k,v] of Object.entries(x)){
      if(FORBIDDEN_POLICY_KEYS.has(k)) hits.push(pathSoFar+'.'+k);
      hits.push(...scanForbidden(v,pathSoFar+'.'+k));
    }
  }
  return hits;
}

function hiddenEventIds(world){
  return new Set((world.hidden_state.hidden_events??[]).map(e=>e.event_id));
}
function visibleSourceIds(world){
  return new Set((world.policy_input.evidence??[]).map(e=>e.source_event_id));
}

export function validatePair(pair){
  const errors=[];
  if(pair.schema_version!=='evidence-surface-v2-paired-world-v0') errors.push('bad schema_version');
  if(!pair.pair_id) errors.push('missing pair_id');
  if(pair.world_a?.world_id===pair.world_b?.world_id) errors.push('world ids must differ');
  if(pair.pair_contract?.requires_exact_policy_input_equality!==true) errors.push('exact-input contract must be true');
  if(pair.pair_contract?.requires_disjoint_decisive_truth!==true) errors.push('disjoint-truth contract must be true');
  if(pair.pair_contract?.requires_clean_current_surface!==true) errors.push('clean-current-surface contract must be true');

  const aInput=pair.world_a?.policy_input;
  const bInput=pair.world_b?.policy_input;
  if(canonString(aInput)!==canonString(bInput)) errors.push('policy inputs are not exactly equal');

  for(const [label,input] of [['world_a',aInput],['world_b',bInput]]){
    const nonCurrent=(input?.evidence??[]).filter(e=>e.currentness!=='current');
    if(nonCurrent.length) errors.push(label+' visible evidence must all be current: '+nonCurrent.map(e=>e.evidence_id+'='+e.currentness).join(', '));
  }

  const forbidden=[...scanForbidden(aInput),...scanForbidden(bInput)];
  if(forbidden.length) errors.push('forbidden policy-input fields: '+forbidden.join(', '));

  const aActions=new Set((pair.world_a?.allowed_decisive_actions??[]).map(actionKey));
  const bActions=new Set((pair.world_b?.allowed_decisive_actions??[]).map(actionKey));
  if(aActions.size===0||bActions.size===0) errors.push('each world needs at least one allowed decisive action');
  const overlap=[...aActions].filter(x=>bActions.has(x));
  if(overlap.length) errors.push('allowed decisive actions overlap: '+overlap.join(', '));

  if(canonString(pair.world_a?.hidden_state)===canonString(pair.world_b?.hidden_state)) errors.push('hidden world states must differ');

  for(const worldName of ['world_a','world_b']){
    const world=pair[worldName];
    const hidden=hiddenEventIds(world);
    const visible=visibleSourceIds(world);
    const leaked=[...hidden].filter(id=>visible.has(id));
    if(leaked.length) errors.push(worldName+' hidden event ids leak into visible source ids: '+leaked.join(', '));
  }


  const aTruth=pair.world_a?.hidden_state?.surface_complete_truth;
  const bTruth=pair.world_b?.hidden_state?.surface_complete_truth;
  if(typeof aTruth!=='boolean'||typeof bTruth!=='boolean') errors.push('surface_complete_truth must be boolean in both worlds');
  else if(aTruth===bTruth) errors.push('paired worlds must differ in surface_complete_truth');

  for(const worldName of ['world_a','world_b']){
    const ctx=pair[worldName]?.acquisition_context;
    if(!ctx||!Array.isArray(ctx.required_channels)||!Array.isArray(ctx.channels)){
      errors.push(worldName+' missing acquisition_context');
      continue;
    }
    const ids=ctx.channels.map(x=>x.channel_id);
    for(const required of ctx.required_channels){
      if(ids.filter(x=>x===required).length!==1) errors.push(worldName+' required channel must appear exactly once: '+required);
    }
    for(const ch of ctx.channels){
      if(ch.retrieved_head_seq>ch.source_head_seq) errors.push(worldName+' retrieved head exceeds source head: '+ch.channel_id);
    }
  }

  const fallbacks=pair.safe_fallback_actions??[];
  if(!Array.isArray(fallbacks)||fallbacks.length===0) errors.push('safe_fallback_actions must be nonempty');

  return {
    pair_id:pair.pair_id,
    valid:errors.length===0,
    errors,
    policy_input_hash_a:aInput?hash(aInput):null,
    policy_input_hash_b:bInput?hash(bInput):null,
    exact_policy_input_equal:aInput&&bInput?canonString(aInput)===canonString(bInput):false,
    visible_evidence_count:aInput?.evidence?.length??null,
    visible_canonical_bytes:aInput?Buffer.byteLength(canonString(aInput),'utf8'):null,
    allowed_decisive_actions_a:[...aActions].sort(),
    allowed_decisive_actions_b:[...bActions].sort(),
    decisive_truth_disjoint:overlap.length===0,
    surface_complete_truth_a:aTruth,
    surface_complete_truth_b:bTruth,
    deterministic_surface_only_bound:
      overlap.length===0 && aInput&&bInput && canonString(aInput)===canonString(bInput)
      ? 'A deterministic policy restricted to policy_input must emit the same output in both worlds; any decisive output can be valid in at most one world.'
      : null
  };
}

export function validateFile(file){
  const pairs=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const seen=new Set(),results=[];
  for(const pair of pairs){
    const r=validatePair(pair);
    if(seen.has(pair.pair_id)){r.valid=false;r.errors.push('duplicate pair_id');}
    seen.add(pair.pair_id);
    results.push(r);
  }
  return {
    schema_version:1,
    file:path.basename(file),
    pairs:pairs.length,
    valid_pairs:results.filter(r=>r.valid).length,
    invalid_pairs:results.filter(r=>!r.valid).length,
    all_valid:results.every(r=>r.valid),
    all_policy_inputs_exact:results.every(r=>r.exact_policy_input_equal),
    all_decisive_truth_disjoint:results.every(r=>r.decisive_truth_disjoint),
    results
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=process.argv[2];
  if(!file){console.error('usage: node validate-paired-world.mjs <jsonl> [report.json]');process.exit(2);}
  const report=validateFile(path.resolve(file));
  if(process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(!report.all_valid) process.exit(1);
}
