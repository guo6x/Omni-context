import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnnotationPackets } from './build-annotation-packets.mjs';

const sample={
  schema_version:'evidence-surface-v1',sample_id:'es-v1-f1-001',family:'F1',domain:'software',
  question:'Choose A or B',query_time:'2026-10-01T00:00:00.000Z',
  risk:{level:'low',reversibility:'reversible'},
  source_events:[
    {event_id:'src-001',at:'2026-09-01T00:00:00.000Z',actor_type:'user',content:'Need a choice'},
    {event_id:'src-002',at:'2026-09-02T00:00:00.000Z',actor_type:'document',content:'A is compatible'}
  ],
  candidates:[
    {candidate_id:'opt-a',label:'A',description:'A',evidence_refs:['ev-002']},
    {candidate_id:'opt-b',label:'B',description:'B',evidence_refs:[]}
  ],
  evidence:[
    {evidence_id:'ev-001',role:'constraint',fact:'Compatibility required',source_event_id:'src-001',at:'2026-09-01T00:00:00.000Z',currentness:'current'},
    {evidence_id:'ev-002',role:'current_fact',fact:'A is compatible',source_event_id:'src-002',at:'2026-09-02T00:00:00.000Z',currentness:'current'}
  ],
  prior_state:{prior_decision:null,standing_instruction:null},
  constructor_proposal:{treatment_target_evidence_id:'ev-002',full_acceptable_action_families:['DECIDE'],hidden_safe_action_families:['DEFER'],rationale:'needed'},
  construction_provenance:{constructor_id:'c',template_id:'t',authored_at:'2026-10-06T00:00:00.000Z',source_type:'human_design'}
};

test('annotation packets hide constructor proposal and target source in reduced surface',()=>{
  const packets=buildAnnotationPackets([sample]);
  assert.equal(packets.length,2);
  const full=packets.find(x=>x.annotation_view==='SOURCE_TRUTH');
  const reduced=packets.find(x=>x.annotation_view==='REDUCED_SURFACE');
  assert.equal('constructor_proposal' in full.visible_sample,false);
  assert.equal(reduced.visible_sample.evidence.some(e=>e.evidence_id==='ev-002'),false);
  assert.equal(reduced.visible_sample.source_events.some(e=>e.event_id==='src-002'),false);
  assert.equal(reduced.visible_sample.candidates[0].evidence_refs.includes('ev-002'),false);
});
