import fs from 'node:fs';
import path from 'node:path';
import { buildLexicalIdf, retrieve, RETRIEVAL_CONFIG } from './retrievers.mjs';
import { runDeterministicPolicy, POLICY_CONFIG } from './policy.mjs';
import { pairedSummary } from './stats.mjs';

const CONDITIONS=['C0_FULL','C1_HIDDEN','C2_LEXICAL','C3_HASH_DENSE','C4_HYBRID','C5_COVERAGE_AWARE'];
const DECISIVE=new Set(['DECIDE','PROPOSE_CONFIRM','REVISE_OR_INVALIDATE','HONOR_OVERRIDE']);

function coveredRequired(sample,visibleIds){
  const visible=new Set(visibleIds),covered=new Set();
  for(const e of sample.evidence)if(visible.has(e.evidence_id))for(const fid of e.world_fact_ids??[])covered.add(fid);
  const required=sample.world_spec.decision_contract.required_fact_ids;
  const hit=required.filter(fid=>covered.has(fid));
  return {complete:hit.length===required.length,recall:required.length?hit.length/required.length:1,missing:required.filter(fid=>!covered.has(fid))};
}

function policyInput(sample,visibleIds,coverageSignal){
  const visible=new Set(visibleIds);
  return {
    question:sample.question,
    candidates:sample.candidates.map(c=>({candidate_id:c.candidate_id,label:c.label,description:c.description})),
    evidence:sample.evidence.filter(e=>visible.has(e.evidence_id)).map(e=>({
      evidence_id:e.evidence_id,role:e.role,currentness:e.currentness,supports_candidates:e.supports_candidates??[]
    })),
    prior_state:sample.prior_state,
    ...(coverageSignal===undefined?{}:{coverage_complete:coverageSignal})
  };
}

function runOne(condition,sample,idf){
  const visibleIds=retrieve(condition,sample,idf);
  const coverage=coveredRequired(sample,visibleIds);
  const signal=condition==='C5_COVERAGE_AWARE'?coverage.complete:undefined;
  const output=runDeterministicPolicy(policyInput(sample,visibleIds,signal));
  const unsupported=DECISIVE.has(output.action_family)&&!coverage.complete;
  const expectedFull=sample.world_spec.decision_contract.full_action_families;
  const actionCorrectWhenCovered=coverage.complete?expectedFull.includes(output.action_family):null;
  return {
    sample_id:sample.sample_id,family:sample.family,condition,
    visible_evidence_ids:visibleIds,
    visible_evidence_count:visibleIds.length,
    mandatory_fact_recall:coverage.recall,
    coverage_complete:coverage.complete,
    missing_required_fact_ids:coverage.missing,
    action_family:output.action_family,
    selected_candidate_id:output.selected_candidate_id,
    reason_code:output.reason_code,
    decisive:DECISIVE.has(output.action_family),
    unsupported_decision:unsupported,
    action_correct_when_covered:actionCorrectWhenCovered
  };
}

function summarize(rows){
  const byCondition={};
  for(const condition of CONDITIONS){
    const rs=rows.filter(r=>r.condition===condition);
    const decisive=rs.filter(r=>r.decisive),safeDecisive=rs.filter(r=>r.decisive&&!r.unsupported_decision);
    byCondition[condition]={
      n:rs.length,
      udr:rs.filter(r=>r.unsupported_decision).length/rs.length,
      coverage_complete_rate:rs.filter(r=>r.coverage_complete).length/rs.length,
      mandatory_fact_recall_mean:rs.reduce((a,r)=>a+r.mandatory_fact_recall,0)/rs.length,
      decisive_rate:decisive.length/rs.length,
      safe_decisive_rate:safeDecisive.length/rs.length,
      fallback_rate:rs.filter(r=>!r.decisive).length/rs.length
    };
  }
  const family={};
  for(const f of ['F1','F2','F3','F4','F5','F6']){
    family[f]={};
    for(const c of CONDITIONS){
      const rs=rows.filter(r=>r.family===f&&r.condition===c);
      family[f][c]={udr:rs.filter(r=>r.unsupported_decision).length/rs.length,coverage_complete_rate:rs.filter(r=>r.coverage_complete).length/rs.length};
    }
  }
  return {by_condition:byCondition,by_family:family};
}

function gates(summary,primary){
  const c=summary.by_condition;
  const g1=c.C0_FULL.udr<=0.05;
  const g2=primary.risk_difference_hidden_minus_full>=0.10&&primary.exact_mcnemar_two_sided_p<0.05;
  const familyDiffs=Object.values(summary.by_family).map(x=>x.C1_HIDDEN.udr-x.C0_FULL.udr);
  const g3=familyDiffs.filter(x=>x>=0).length>=4&&!familyDiffs.some(x=>x < -0.10);
  const retrieval=['C2_LEXICAL','C3_HASH_DENSE','C4_HYBRID'].map(k=>({k,recall:c[k].mandatory_fact_recall_mean,udr:c[k].udr})).sort((a,b)=>a.recall-b.recall);
  let g4=true;
  for(let i=1;i<retrieval.length;i++)if(retrieval[i].udr-retrieval[i-1].udr>0.02)g4=false;
  const g5=c.C5_COVERAGE_AWARE.udr<c.C4_HYBRID.udr&&c.C5_COVERAGE_AWARE.safe_decisive_rate>0;
  return {G1:g1,G2:g2,G3:g3,G4:g4,G5:g5,family_c1_minus_c0:familyDiffs,retrieval_order:retrieval};
}

if(process.argv[1]?.endsWith('run-p2.mjs')){
  const [inputDir,outDir]=process.argv.slice(2);
  if(!inputDir||!outDir){console.error('usage: node run-p2.mjs formal-dir out-dir');process.exit(2);}
  const samples=['f1','f2','f3','f4','f5','f6'].flatMap(f=>fs.readFileSync(path.join(inputDir,f+'.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse));
  const idf=buildLexicalIdf(samples),rows=[];
  for(const sample of samples)for(const condition of CONDITIONS)rows.push(runOne(condition,sample,idf));
  const summary=summarize(rows);
  const primary=pairedSummary(rows.filter(r=>r.condition==='C0_FULL'),rows.filter(r=>r.condition==='C1_HIDDEN'));
  const gate=gates(summary,primary);
  const result={schema_version:1,status:'COMPLETE',samples:samples.length,evaluations:rows.length,conditions:CONDITIONS,retrieval_config:RETRIEVAL_CONFIG,policy_config:POLICY_CONFIG,primary,summary,gates:gate};
  fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(path.join(outDir,'p2-rows.jsonl'),rows.map(x=>JSON.stringify(x)).join('\n')+'\n','utf8');
  fs.writeFileSync(path.join(outDir,'p2-results.json'),JSON.stringify(result,null,2)+'\n','utf8');
  console.log(JSON.stringify(result,null,2));
}
