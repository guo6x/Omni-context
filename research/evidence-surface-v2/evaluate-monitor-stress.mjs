import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquisitionLedgerMonitor } from './monitor-acquisition-ledger.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));

export function evaluateStress(file){
  const cases=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const rows=cases.map(c=>{
    const out=acquisitionLedgerMonitor(c.acquisition_context);
    const predComplete=out.status==='COMPLETE';
    return {
      case_id:c.case_id,
      class:c.class,
      truth_complete:c.surface_complete_truth,
      predicted_complete:predComplete,
      status:out.status,
      reasons:out.reasons,
      false_complete:predComplete && !c.surface_complete_truth,
      false_incomplete:!predComplete && c.surface_complete_truth,
      correct:predComplete===c.surface_complete_truth
    };
  });
  const byClass={};
  for(const row of rows) byClass[row.class]={
    n:1,
    truth_complete:row.truth_complete,
    predicted_complete:row.predicted_complete,
    false_complete:row.false_complete,
    false_incomplete:row.false_incomplete,
    reasons:row.reasons
  };
  return {
    schema_version:1,
    cases:rows.length,
    correct_count:rows.filter(r=>r.correct).length,
    false_complete_count:rows.filter(r=>r.false_complete).length,
    false_incomplete_count:rows.filter(r=>r.false_incomplete).length,
    by_class:byClass,
    rows
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const file=process.argv[2]??path.join(HERE,'dev/monitor-stress.jsonl');
  const out=process.argv[3];
  const r=evaluateStress(path.resolve(file));
  if(out) fs.writeFileSync(path.resolve(out),JSON.stringify(r,null,2)+'\n');
  console.log(JSON.stringify(r,null,2));
}
