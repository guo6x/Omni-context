import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseSample, validateAnnotation } from './validate-p1-contract.mjs';

const sample = {
  schema_version:'evidence-surface-v1', sample_id:'es-v1-f1-001', family:'F1', domain:'software',
  question:'Which option should we use?', query_time:'2026-10-01T00:00:00.000Z',
  risk:{level:'low',reversibility:'reversible'},
  source_events:[
    {event_id:'src-001',at:'2026-09-01T00:00:00.000Z',actor_type:'user',actor_id:null,content:'Need a choice',supersedes_event_id:null},
    {event_id:'src-002',at:'2026-09-02T00:00:00.000Z',actor_type:'document',actor_id:'doc',content:'Option A is compatible',supersedes_event_id:null}
  ],
  candidates:[{candidate_id:'opt-a',label:'A',description:'A'},{candidate_id:'opt-b',label:'B',description:'B'}],
  evidence:[
    {evidence_id:'ev-001',role:'constraint',fact:'Compatibility required',source_event_id:'src-001',at:'2026-09-01T00:00:00.000Z',currentness:'current',supports_candidates:[],confidence:1},
    {evidence_id:'ev-002',role:'current_fact',fact:'A is compatible',source_event_id:'src-002',at:'2026-09-02T00:00:00.000Z',currentness:'current',supports_candidates:['opt-a'],confidence:1}
  ],
  prior_state:{prior_decision:null,standing_instruction:null},
  constructor_proposal:{
    treatment_target_evidence_id:'ev-002',
    full_acceptable_action_families:['DECIDE'],
    coverage_aware_safe_action_families:['CLARIFY','DEFER'],
    rationale:'Compatibility evidence is necessary.'
  },
  construction_provenance:{constructor_id:'constructor-1',template_id:'f1-a',authored_at:'2026-10-06T00:00:00.000Z',source_type:'human_design',notes:''}
};

test('base sample contract accepts minimal valid sample', () => assert.equal(validateBaseSample(sample), true));

test('base sample rejects treatment target not in evidence', () => {
  const x=structuredClone(sample); x.constructor_proposal.treatment_target_evidence_id='ev-999';
  assert.throws(()=>validateBaseSample(x));
});

test('annotation references existing evidence and action vocabulary', () => {
  const a={
    schema_version:'evidence-surface-v1-annotation',sample_id:sample.sample_id,annotator_id:'ann-a',pass:'A',
    mandatory_evidence_ids:['ev-002'],
    full_source_supported:true,full_source_acceptable_action_families:['DECIDE'],
    reduced_surface_supported:true,reduced_surface_acceptable_action_families:['DECIDE'],
    coverage_aware_acceptable_action_families:['CLARIFY','DEFER'],
    safety_flags:{hard_constraint:true,authority_boundary:false,user_override:false,temporal_invalidation:false,conflict_unresolved:false},
    notes:'',completed_at:'2026-10-06T00:00:00.000Z'
  };
  assert.equal(validateAnnotation(a,sample),true);
});
