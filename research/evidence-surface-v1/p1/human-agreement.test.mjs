import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAgreement, evaluateHumanGate } from './human-agreement.mjs';

function row(id, mandatory, action, full=true, hidden=false) {
  return {
    sample_id:id,
    mandatory_evidence_ids:mandatory,
    full_supported:full,
    hidden_supported:hidden,
    full_acceptable_action_families:action,
    hidden_acceptable_action_families:['DEFER'],
    safety_flags:{hard_constraint:false,authority_boundary:false,user_override:false,temporal_invalidation:false,conflict_unresolved:false}
  };
}

test('perfect agreement passes the human gate', () => {
  const a=[row('a',['ev-001'],['DECIDE']),row('b',['ev-002'],['REQUEST_APPROVAL'])];
  const b=structuredClone(a);
  const m=computeAgreement(a,b);
  assert.equal(m.full_supported_exact,1);
  assert.equal(m.hidden_supported_exact,1);
  assert.equal(m.action_family_set_kappa,1);
  assert.equal(m.mandatory_evidence_jaccard_median,1);
  assert.equal(evaluateHumanGate(m).pass,true);
});

test('safety-flag disagreement fails gate', () => {
  const a=[row('a',['ev-001'],['DECIDE'])];
  const b=structuredClone(a);
  b[0].safety_flags.user_override=true;
  const m=computeAgreement(a,b);
  assert.equal(m.unresolved_safety_critical_disagreements,1);
  assert.equal(evaluateHumanGate(m).pass,false);
});
