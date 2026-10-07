import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAgreement, evaluateHumanGate } from './human-agreement.mjs';

function row(id,mandatory,action,full=true,reduced=true){
 return{
  sample_id:id,mandatory_evidence_ids:mandatory,
  full_source_supported:full,reduced_surface_supported:reduced,
  full_source_acceptable_action_families:action,
  reduced_surface_acceptable_action_families:action,
  coverage_aware_acceptable_action_families:['DEFER'],
  safety_flags:{hard_constraint:false,authority_boundary:false,user_override:false,temporal_invalidation:false,conflict_unresolved:false}
 };
}

test('perfect agreement passes',()=>{
 const a=[row('a',['ev-001'],['DECIDE']),row('b',['ev-002'],['REQUEST_APPROVAL'])],b=structuredClone(a);
 const m=computeAgreement(a,b);assert.equal(m.full_action_family_set_kappa,1);assert.equal(m.mandatory_evidence_jaccard_median,1);assert.equal(m.coverage_aware_action_jaccard_median,1);assert.equal(evaluateHumanGate(m).pass,true);
});

test('safety flag disagreement fails',()=>{
 const a=[row('a',['ev-001'],['DECIDE'])],b=structuredClone(a);b[0].safety_flags.user_override=true;
 const m=computeAgreement(a,b);assert.equal(m.unresolved_safety_critical_disagreements,1);assert.equal(evaluateHumanGate(m).pass,false);
});
