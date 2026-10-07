import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { executePairedSurface } from './execution-kernel.mjs';

function readJsonl(file){
  return fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}
function sha(file){
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function rate(n,d){return d? n/d : null;}

function summarizeGroup(rows){
  const worlds=rows.flatMap(r=>r.worlds);
  return {
    pair_condition_rows:rows.length,
    world_scores:worlds.length,
    policy_calls:rows.reduce((n,r)=>n+r.policy_call_count,0),
    decisive_worlds:worlds.filter(w=>w.decisive).length,
    correct_decisive_worlds:worlds.filter(w=>w.correct_decisive).length,
    world_action_violations:worlds.filter(w=>w.world_action_violation).length,
    pairs_with_any_violation:rows.filter(r=>r.worlds.some(w=>w.world_action_violation)).length,
    monitor_false_complete:worlds.filter(w=>w.monitor_false_complete).length,
    monitor_false_incomplete:worlds.filter(w=>w.monitor_false_incomplete).length,
    completion_rate:rate(worlds.filter(w=>w.decisive).length,worlds.length),
    wavr:rate(worlds.filter(w=>w.world_action_violation).length,worlds.length),
    pdvr:rate(rows.filter(r=>r.worlds.some(w=>w.world_action_violation)).length,rows.length),
    decisive_correctness:rate(
      worlds.filter(w=>w.correct_decisive).length,
      worlds.filter(w=>w.decisive).length
    ),
    monitor_false_complete_rate:rate(
      worlds.filter(w=>w.monitor_false_complete).length,
      worlds.filter(w=>w.surface_complete_truth===false).length
    ),
    monitor_false_incomplete_rate:rate(
      worlds.filter(w=>w.monitor_false_incomplete).length,
      worlds.filter(w=>w.surface_complete_truth===true).length
    )
  };
}

function groupBy(rows,fn){
  const out={};
  for(const row of rows){
    const k=fn(row);
    if(!out[k])out[k]=[];
    out[k].push(row);
  }
  return out;
}

export function runPairedMatrix(pairs,matrix){
  if(matrix.status!=='FROZEN_PRE_OUTCOME_MATRIX')throw new Error('execution matrix not frozen');
  if(matrix.paired_surface_conditions.length!==9)throw new Error('paired matrix must contain exactly 9 conditions');
  const rows=[];
  for(const cond of matrix.paired_surface_conditions){
    for(const pair of pairs){
      const r=executePairedSurface(pair,{policy:cond.policy,monitor:cond.monitor});
      rows.push({...r,condition_id:cond.condition_id});
    }
  }

  const byCondition={};
  for(const [id,rs] of Object.entries(groupBy(rows,r=>r.condition_id))){
    byCondition[id]={
      overall:summarizeGroup(rs),
      by_family:Object.fromEntries(
        Object.entries(groupBy(rs,r=>r.family)).map(([k,v])=>[k,summarizeGroup(v)])
      )
    };
    if(rs[0]?.monitor==='M3_ACQUISITION_LEDGER'){
      byCondition[id].by_ledger_profile=Object.fromEntries(
        Object.entries(groupBy(rs,r=>r.ledger_profile??'NONE')).map(([k,v])=>[k,summarizeGroup(v)])
      );
    }
  }
  return {
    rows,
    summary:{
      paired_surface_conditions:matrix.paired_surface_conditions.length,
      pairs:pairs.length,
      expected_pair_condition_rows:matrix.paired_surface_conditions.length*pairs.length,
      actual_pair_condition_rows:rows.length,
      by_condition:byCondition
    }
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2]||!process.argv[3]||!process.argv[4]){
    console.error('usage: node run-paired-surface-matrix.mjs <pairs.jsonl> <matrix.json> <out.json> [status]');
    process.exit(2);
  }
  const pairFile=path.resolve(process.argv[2]);
  const matrixFile=path.resolve(process.argv[3]);
  const outFile=path.resolve(process.argv[4]);
  const status=process.argv[5]??'DEVELOPMENT_RESULT';
  if(!['DEVELOPMENT_RESULT','CONFIRMATORY_RESULT'].includes(status))throw new Error('bad result status');
  const pairs=readJsonl(pairFile);
  const matrix=JSON.parse(fs.readFileSync(matrixFile,'utf8'));
  const r=runPairedMatrix(pairs,matrix);
  const out={
    schema_version:1,
    status,
    frozen_corpus_sha256:sha(pairFile),
    rows:r.rows,
    summary:r.summary
  };
  fs.writeFileSync(outFile,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({
    status,
    frozen_corpus_sha256:out.frozen_corpus_sha256,
    paired_surface_conditions:out.summary.paired_surface_conditions,
    pairs:out.summary.pairs,
    pair_condition_rows:out.summary.actual_pair_condition_rows
  },null,2));
}
