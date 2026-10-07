import test from 'node:test';
import assert from 'node:assert/strict';
import { runPairedMatrix } from './run-paired-surface-matrix.mjs';

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
  construction_provenance:{ledger_profile:'L0_CLEAN_TRACKED'},
  world_a:{
    world_id:'A',policy_input:input,
    hidden_state:{surface_complete_truth:true},
    allowed_decisive_actions:[{action_family:'PROCEED',selected_candidate_id:'go'}],
    acquisition_context:{required_channels:['c1'],channels:[{channel_id:'c1',source_head_seq:1,retrieved_head_seq:1,index_complete:true,retrieval_complete:true}]}
  },
  world_b:{
    world_id:'B',policy_input:JSON.parse(JSON.stringify(input)),
    hidden_state:{surface_complete_truth:false},
    allowed_decisive_actions:[{action_family:'HOLD',selected_candidate_id:'hold'}],
    acquisition_context:{required_channels:['c1'],channels:[{channel_id:'c1',source_head_seq:2,retrieved_head_seq:1,index_complete:true,retrieval_complete:true}]}
  }
};
const matrix={
  status:'FROZEN_PRE_OUTCOME_MATRIX',
  paired_surface_conditions:[
    {condition_id:'PS-M0-P0',policy:'P0_SURFACE_VOTE',monitor:'M0_NO_MONITOR'},
    {condition_id:'PS-M0-P1',policy:'P1_CURRENTNESS_FIRST',monitor:'M0_NO_MONITOR'},
    {condition_id:'PS-M1',policy:'P_NONE',monitor:'M1_ALWAYS_DEFER'},
    {condition_id:'PS-M2-P0',policy:'P0_SURFACE_VOTE',monitor:'M2_SURFACE_ONLY_HEURISTIC'},
    {condition_id:'PS-M2-P1',policy:'P1_CURRENTNESS_FIRST',monitor:'M2_SURFACE_ONLY_HEURISTIC'},
    {condition_id:'PS-M3-P0',policy:'P0_SURFACE_VOTE',monitor:'M3_ACQUISITION_LEDGER'},
    {condition_id:'PS-M3-P1',policy:'P1_CURRENTNESS_FIRST',monitor:'M3_ACQUISITION_LEDGER'},
    {condition_id:'PS-M4-P0',policy:'P0_SURFACE_VOTE',monitor:'M4_ORACLE_COMPLETENESS'},
    {condition_id:'PS-M4-P1',policy:'P1_CURRENTNESS_FIRST',monitor:'M4_ORACLE_COMPLETENESS'}
  ]
};

test('runner emits exactly nine condition rows per paired surface',()=>{
  const r=runPairedMatrix([pair],matrix);
  assert.equal(r.rows.length,9);
  assert.equal(r.summary.expected_pair_condition_rows,9);
  assert.equal(r.summary.actual_pair_condition_rows,9);
  assert.equal(new Set(r.rows.map(x=>x.condition_id)).size,9);
});

test('always-defer appears once and makes zero policy calls',()=>{
  const r=runPairedMatrix([pair],matrix);
  const m1=r.rows.filter(x=>x.monitor==='M1_ALWAYS_DEFER');
  assert.equal(m1.length,1);
  assert.equal(m1[0].policy,'P_NONE');
  assert.equal(m1[0].policy_call_count,0);
});

test('M3 exposes ledger-stratified monitor errors',()=>{
  const r=runPairedMatrix([pair],matrix);
  for(const id of ['PS-M3-P0','PS-M3-P1']){
    const x=r.summary.by_condition[id];
    assert.ok(x.by_ledger_profile.L0_CLEAN_TRACKED);
    assert.equal(x.overall.monitor_false_complete,0);
    assert.equal(x.overall.monitor_false_incomplete,0);
  }
});

test('M0 records expected false-complete diagnostic on the incomplete B world',()=>{
  const r=runPairedMatrix([pair],matrix);
  const row=r.rows.find(x=>x.condition_id==='PS-M0-P0');
  const b=row.worlds.find(x=>x.member==='B');
  assert.equal(b.surface_complete_truth,false);
  assert.equal(b.monitor_false_complete,true);
});
