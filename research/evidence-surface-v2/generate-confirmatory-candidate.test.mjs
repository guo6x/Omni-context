import test from 'node:test';
import assert from 'node:assert/strict';
import { generateConfirmatoryCandidate, CONFIRMATORY_FAMILIES, LEDGER_PROFILES } from './generate-confirmatory-candidate.mjs';
import { auditConfirmatoryStructure } from './audit-confirmatory-structure.mjs';

test('confirmatory structural candidate is deterministic and outcome-free by construction',()=>{
  const a=generateConfirmatoryCandidate(),b=generateConfirmatoryCandidate();
  assert.equal(a.length,160);
  assert.deepEqual(a,b);
  assert.ok(a.every(x=>x.construction_provenance.split==='confirmatory'));
});

test('confirmatory structure is balanced across families and ledger fidelity',()=>{
  const r=auditConfirmatoryStructure();
  assert.equal(r.pairs,160);
  for(const f of CONFIRMATORY_FAMILIES){
    assert.equal(r.family_counts[f],32);
    for(const p of LEDGER_PROFILES)assert.equal(r.per_family_ledger_profile_counts[f][p],8);
  }
});

test('confirmatory structure passes dual construct and leakage gates',()=>{
  const r=auditConfirmatoryStructure();
  assert.equal(r.dual_validators_pass,true);
  assert.equal(r.all_clean_current,true);
  assert.equal(r.all_profile_shapes_valid,true);
  assert.equal(r.exact_surface_duplicate_groups.length,0);
  assert.equal(r.within_confirmatory_near_duplicates.length,0);
  assert.equal(r.cross_split_leakage_pairs.length,0);
  assert.ok(Object.values(r.gates).every(Boolean));
});
