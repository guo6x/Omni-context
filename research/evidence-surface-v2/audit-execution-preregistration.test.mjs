import test from 'node:test';
import assert from 'node:assert/strict';
import {auditPreregistration} from './audit-execution-preregistration.mjs';

test('pre-outcome preregistration binds 160 pairs and all 21 conditions',()=>{
 const r=auditPreregistration();
 assert.equal(r.status,'PASS',JSON.stringify(r.errors));
 assert.equal(r.paired_condition_count,9);
 assert.equal(r.retrieval_condition_count,12);
 assert.match(r.preregistration_sha256,/^[a-f0-9]{64}$/);
 assert.equal(r.confirmatory_outcome_executed,false);
});
