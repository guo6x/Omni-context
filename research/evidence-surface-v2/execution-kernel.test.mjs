import test from 'node:test';
import assert from 'node:assert/strict';
import { executePairedSurface } from './execution-kernel.mjs';

const input={
  question:'Should the action proceed?',
  candidates:[
    {candidate_id:'go',label:'Proceed',action_family:'PROCEED'},
    {candidate_id:'hold',label:'Hold',action_family:'HOLD'}
  ],
  evidence:[
    {evidence_id:'e1',role:'standing_instruction',fact:'Proceed.',currentness:'current',supports_candidates:['go'],source_event_id:'s1'}
  ],
  prior_state:null
};
const pair={
  pair_id:'test-pair',
  family:'REVOCATION',
  world_a:{
    world_id:'A',
    policy_input:input,
    hidden_state:{surface_complete_truth:true},
    allowed_decisive_actions:[{action_family:'PROCEED',selected_candidate_id:'go'}],
    acquisition_context:{
      required_channels:['c1'],
      channels:[{channel_id:'c1',source_head_seq:1,retrieved_head_seq:1,index_complete:true,retrieval_complete:true}]
    }
  },
  world_b:{
    world_id:'B',
    policy_input:JSON.parse(JSON.stringify(input)),
    hidden_state:{surface_complete_truth:false},
    allowed_decisive_actions:[{action_family:'HOLD',selected_candidate_id:'hold'}],
    acquisition_context:{
      required_channels:['c1'],
      channels:[{channel_id:'c1',source_head_seq:2,retrieved_head_seq:1,index_complete:true,retrieval_complete:true}]
    }
  }
};

test('M0 calls a surface policy once and scores that shared output in both worlds',()=>{
  const r=executePairedSurface(pair,{policy:'P0_SURFACE_VOTE',monitor:'M0_NO_MONITOR'});
  assert.equal(r.policy_call_count,1);
  assert.equal(r.worlds[0].action.selected_candidate_id,'go');
  assert.equal(r.worlds[1].action.selected_candidate_id,'go');
  assert.equal(r.worlds[0].world_action_violation,false);
  assert.equal(r.worlds[1].world_action_violation,true);
});

test('M1 performs no policy call',()=>{
  const r=executePairedSurface(pair,{policy:'P_NONE',monitor:'M1_ALWAYS_DEFER'});
  assert.equal(r.policy_call_count,0);
  assert.equal(r.worlds.every(w=>!w.decisive),true);
});

test('M1 rejects duplicated policy-labelled baselines',()=>{
  assert.throws(
    ()=>executePairedSurface(pair,{policy:'P0_SURFACE_VOTE',monitor:'M1_ALWAYS_DEFER'}),
    /must use P_NONE/
  );
});

test('M3 calls the shared policy at most once and can gate worlds differently',()=>{
  const r=executePairedSurface(pair,{policy:'P1_CURRENTNESS_FIRST',monitor:'M3_ACQUISITION_LEDGER'});
  assert.equal(r.policy_call_count,1);
  assert.equal(r.worlds[0].monitor_status,'COMPLETE');
  assert.equal(r.worlds[1].monitor_status,'INCOMPLETE');
  assert.equal(r.worlds[0].decisive,true);
  assert.equal(r.worlds[1].decisive,false);
});

test('M4 uses formal completeness only as an oracle upper bound',()=>{
  const r=executePairedSurface(pair,{policy:'P0_SURFACE_VOTE',monitor:'M4_ORACLE_COMPLETENESS'});
  assert.equal(r.policy_call_count,1);
  assert.equal(r.worlds[0].decisive,true);
  assert.equal(r.worlds[1].decisive,false);
});

test('kernel rejects non-identical paired policy inputs',()=>{
  const bad=JSON.parse(JSON.stringify(pair));
  bad.world_b.policy_input.question='Different question';
  assert.throws(()=>executePairedSurface(bad,{policy:'P0_SURFACE_VOTE',monitor:'M0_NO_MONITOR'}),/not canonically identical/);
});
