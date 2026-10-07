import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateDevPairs } from './generate-dev-paired-worlds.mjs';
import { runDev } from './run-dev-policy-monitor.mjs';
import { evaluatePairedPolicies } from './evaluate-paired-world-policies.mjs';

function withCorpus(fn){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'es-v2-dev-'));
  const file=path.join(dir,'pairs.jsonl');
  fs.writeFileSync(file,generateDevPairs().map(x=>JSON.stringify(x)).join('\n')+'\n');
  try{return fn(file);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}

test('50-pair dev corpus exposes the information boundary at scale',()=>{
  withCorpus(file=>{
    const r=evaluatePairedPolicies(file);
    assert.equal(r.pairs,50);
    for(const name of ['SURFACE_VOTE','CURRENTNESS_FIRST']){
      const x=r.by_policy[name];
      assert.equal(x.identical_output_pairs,50);
      assert.equal(x.both_decisive_pairs,50);
      assert.equal(x.pair_with_any_violation_count,50);
      assert.equal(x.total_world_violations,50);
    }
  });
});

test('clean-ledger dev stratum separates surface-only and acquisition-side monitoring',()=>{
  withCorpus(file=>{
    const r=runDev(file);
    assert.equal(r.pairs,50);
    assert.deepEqual(
      [r.by_condition.M0_NO_MONITOR.wavr_count,r.by_condition.M0_NO_MONITOR.decisive_count],
      [50,100]
    );
    assert.deepEqual(
      [r.by_condition.M1_ALWAYS_DEFER.wavr_count,r.by_condition.M1_ALWAYS_DEFER.decisive_count],
      [0,0]
    );
    assert.deepEqual(
      [r.by_condition.M2_SURFACE_ONLY.wavr_count,r.by_condition.M2_SURFACE_ONLY.decisive_count,r.by_condition.M2_SURFACE_ONLY.false_complete_count],
      [50,100,50]
    );
    assert.deepEqual(
      [r.by_condition.M3_ACQUISITION_LEDGER.wavr_count,r.by_condition.M3_ACQUISITION_LEDGER.decisive_count,r.by_condition.M3_ACQUISITION_LEDGER.false_complete_count,r.by_condition.M3_ACQUISITION_LEDGER.false_incomplete_count],
      [0,50,0,0]
    );
    assert.deepEqual(
      [r.by_condition.M4_ORACLE.wavr_count,r.by_condition.M4_ORACLE.decisive_count],
      [0,50]
    );
  });
});
