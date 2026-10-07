import { surfaceVotePolicy } from './policy-surface-vote.mjs';
import { currentnessFirstPolicy } from './policy-currentness-first.mjs';
import { acquisitionLedgerMonitor, surfaceOnlyMonitor } from './monitor-acquisition-ledger.mjs';

function canonical(x){
  if(Array.isArray(x)) return x.map(canonical);
  if(x&&typeof x==='object') return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));
  return x;
}
function stable(x){return JSON.stringify(canonical(x));}
function actionKey(a){return a.action_family+'::'+String(a.selected_candidate_id??'');}
function allowed(world,action){
  return new Set((world.allowed_decisive_actions??[]).map(actionKey)).has(actionKey(action));
}
function defer(reason){
  return {decisive:false,action_family:'DEFER',selected_candidate_id:null,reason};
}
function policyFor(name){
  if(name==='P0_SURFACE_VOTE') return surfaceVotePolicy;
  if(name==='P1_CURRENTNESS_FIRST') return currentnessFirstPolicy;
  throw new Error('unknown policy '+name);
}
function monitorStates(pair,name){
  const input=pair.world_a.policy_input;
  if(name==='M0_NO_MONITOR') return {
    a:{status:'COMPLETE',reasons:[]},
    b:{status:'COMPLETE',reasons:[]}
  };
  if(name==='M1_ALWAYS_DEFER') return {
    a:{status:'INCOMPLETE',reasons:['ALWAYS_DEFER']},
    b:{status:'INCOMPLETE',reasons:['ALWAYS_DEFER']}
  };
  if(name==='M2_SURFACE_ONLY_HEURISTIC'){
    const m=surfaceOnlyMonitor(input);
    return {a:m,b:JSON.parse(JSON.stringify(m))};
  }
  if(name==='M3_ACQUISITION_LEDGER') return {
    a:acquisitionLedgerMonitor(pair.world_a.acquisition_context),
    b:acquisitionLedgerMonitor(pair.world_b.acquisition_context)
  };
  if(name==='M4_ORACLE_COMPLETENESS') return {
    a:pair.world_a.hidden_state.surface_complete_truth===true
      ? {status:'COMPLETE',reasons:[]}
      : {status:'INCOMPLETE',reasons:['FORMAL_INCOMPLETE_TRUTH']},
    b:pair.world_b.hidden_state.surface_complete_truth===true
      ? {status:'COMPLETE',reasons:[]}
      : {status:'INCOMPLETE',reasons:['FORMAL_INCOMPLETE_TRUTH']}
  };
  throw new Error('unknown monitor '+name);
}

export function executePairedSurface(pair,{policy,monitor}){
  if(stable(pair.world_a.policy_input)!==stable(pair.world_b.policy_input)){
    throw new Error('paired policy inputs are not canonically identical: '+pair.pair_id);
  }

  const monitors=monitorStates(pair,monitor);
  const needsPolicy=monitors.a.status==='COMPLETE'||monitors.b.status==='COMPLETE';
  let sharedPolicyOutput=null;
  let policyCallCount=0;
  if(needsPolicy){
    sharedPolicyOutput=policyFor(policy)(pair.world_a.policy_input);
    policyCallCount=1;
  }

  const score=(member,world,m)=>{
    const action=m.status==='COMPLETE'
      ? sharedPolicyOutput
      : defer('MONITOR_'+m.status+':'+m.reasons.join('|'));
    const decisive=action?.decisive===true;
    return {
      member,
      world_id:world.world_id,
      monitor_status:m.status,
      monitor_reasons:m.reasons,
      action,
      decisive,
      correct_decisive:decisive&&allowed(world,action),
      world_action_violation:decisive&&!allowed(world,action)
    };
  };

  return {
    schema_version:1,
    pair_id:pair.pair_id,
    family:pair.family,
    policy,
    monitor,
    policy_call_count:policyCallCount,
    shared_policy_output:sharedPolicyOutput,
    worlds:[
      score('A',pair.world_a,monitors.a),
      score('B',pair.world_b,monitors.b)
    ]
  };
}

export function summarizePairedResults(rows){
  const worlds=rows.flatMap(r=>r.worlds);
  const pairsWithViolation=rows.filter(r=>r.worlds.some(w=>w.world_action_violation));
  return {
    pairs:rows.length,
    worlds:worlds.length,
    policy_calls:rows.reduce((n,r)=>n+r.policy_call_count,0),
    decisive_worlds:worlds.filter(w=>w.decisive).length,
    correct_decisive_worlds:worlds.filter(w=>w.correct_decisive).length,
    world_action_violations:worlds.filter(w=>w.world_action_violation).length,
    pairs_with_any_violation:pairsWithViolation.length,
    completion_rate:worlds.length?worlds.filter(w=>w.decisive).length/worlds.length:null,
    wavr:worlds.length?worlds.filter(w=>w.world_action_violation).length/worlds.length:null,
    pdvr:rows.length?pairsWithViolation.length/rows.length:null
  };
}
