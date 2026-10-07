import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquisitionLedgerMonitor } from './monitor-acquisition-ledger.mjs';
import { runDev } from './run-dev-policy-monitor.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const toy=path.join(HERE,'dev/paired-world-toy.jsonl');

test('ledger monitor uses only acquisition context',()=>{
  const complete={required_channels:['x'],channels:[{channel_id:'x',source_head_seq:2,retrieved_head_seq:2,index_complete:true,retrieval_complete:true}]};
  const incomplete={required_channels:['x'],channels:[{channel_id:'x',source_head_seq:3,retrieved_head_seq:2,index_complete:true,retrieval_complete:true}]};
  assert.equal(acquisitionLedgerMonitor(complete).status,'COMPLETE');
  assert.equal(acquisitionLedgerMonitor(incomplete).status,'INCOMPLETE');
});

test('paired-world dev monitor trade-off is as designed',()=>{
  const r=runDev(toy);
  assert.equal(r.pairs,3);
  assert.deepEqual(
    [r.by_condition.M0_NO_MONITOR.wavr_count,r.by_condition.M0_NO_MONITOR.decisive_count,r.by_condition.M0_NO_MONITOR.pair_with_any_violation_count],
    [3,6,3]
  );
  assert.deepEqual(
    [r.by_condition.M1_ALWAYS_DEFER.wavr_count,r.by_condition.M1_ALWAYS_DEFER.decisive_count],
    [0,0]
  );
  assert.deepEqual(
    [
      r.by_condition.M2_SURFACE_ONLY.wavr_count,
      r.by_condition.M2_SURFACE_ONLY.decisive_count,
      r.by_condition.M2_SURFACE_ONLY.false_complete_count,
      r.by_condition.M2_SURFACE_ONLY.false_incomplete_count
    ],
    [3,6,3,0]
  );
  assert.deepEqual(
    [r.by_condition.M3_ACQUISITION_LEDGER.wavr_count,r.by_condition.M3_ACQUISITION_LEDGER.decisive_count,r.by_condition.M3_ACQUISITION_LEDGER.false_complete_count,r.by_condition.M3_ACQUISITION_LEDGER.false_incomplete_count],
    [0,3,0,0]
  );
  assert.deepEqual(
    [r.by_condition.M4_ORACLE.wavr_count,r.by_condition.M4_ORACLE.decisive_count],
    [0,3]
  );
});
