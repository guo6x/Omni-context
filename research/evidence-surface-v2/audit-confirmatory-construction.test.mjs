import test from 'node:test';
import assert from 'node:assert/strict';
import { generateConfirmatoryPairs, FAMILIES, REGIMES } from './generate-confirmatory-paired-worlds.mjs';
import { auditConfirmatory } from './audit-confirmatory-construction.mjs';

test('confirmatory generator is deterministic and outcome-free',()=>{
  const a=generateConfirmatoryPairs(),b=generateConfirmatoryPairs();
  assert.equal(a.length,100);
  assert.deepEqual(a,b);
  assert.ok(a.every(x=>x.construction_provenance.split==='confirmatory'));
});

test('confirmatory construction passes frozen pre-outcome gates',()=>{
  const r=auditConfirmatory();
  assert.equal(r.pairs,100);
  assert.equal(r.forbidden_outcome_key_hits.length,0);
  assert.ok(Object.values(r.gates).every(Boolean));
});

test('family by acquisition-regime matrix is exactly balanced',()=>{
  const r=auditConfirmatory();
  for(const f of FAMILIES)for(const regime of REGIMES){
    assert.equal(r.family_regime_counts[f+'::'+regime],5);
  }
});
