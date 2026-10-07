import fs from 'node:fs';
import { evaluateFormalA } from './formal-evaluator-a.mjs';
import { evaluateFormalB } from './formal-evaluator-b.mjs';

const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=x=>[...x].sort();

export function verifyFormalSample(sample){
  const errors=[];
  const allIds=sample.evidence.map(e=>e.evidence_id);
  const A=evaluateFormalA(sample,allIds),B=evaluateFormalB(sample,allIds);

  for(const key of ["required_fact_ids","full_action_families","coverage_aware_action_families","mandatory_evidence_ids"]){
    if(!eq(A[key],B[key])) errors.push("dual-validator disagreement "+key+": A="+JSON.stringify(A[key])+" B="+JSON.stringify(B[key]));
  }
  if(!A.coverage.complete||!B.coverage.complete) errors.push("FULL coverage incomplete");

  const target=sample.constructor_proposal.treatment_target_evidence_id;
  if(!A.mandatory_evidence_ids.includes(target)) errors.push("treatment target is not formally mandatory: "+target);

  const hiddenIds=allIds.filter(id=>id!==target);
  const Ah=evaluateFormalA(sample,hiddenIds),Bh=evaluateFormalB(sample,hiddenIds);
  if(Ah.coverage.complete||Bh.coverage.complete) errors.push("mandatory positive control failed: hiding target kept coverage complete");
  if(!eq(Ah.coverage.missing_fact_ids,Bh.coverage.missing_fact_ids)) errors.push("hidden missing-fact disagreement");

  const nonMandatory=allIds.filter(id=>!A.mandatory_evidence_ids.includes(id));
  if(!nonMandatory.length) errors.push("no non-mandatory evidence available for negative control");
  else{
    const neg=nonMandatory[0];
    const An=evaluateFormalA(sample,allIds.filter(id=>id!==neg));
    const Bn=evaluateFormalB(sample,allIds.filter(id=>id!==neg));
    if(!An.coverage.complete||!Bn.coverage.complete) errors.push("non-mandatory negative control failed for "+neg);
  }

  const proposalFull=sorted(sample.constructor_proposal.full_acceptable_action_families);
  const proposalCoverage=sorted(sample.constructor_proposal.coverage_aware_safe_action_families);
  if(!eq(proposalFull,A.full_action_families)) errors.push("constructor full actions disagree with formal rule");
  if(!eq(proposalCoverage,A.coverage_aware_action_families)) errors.push("constructor coverage-aware actions disagree with formal rule");

  return {
    sample_id:sample.sample_id,
    pass:errors.length===0,
    errors,
    formal:{
      required_fact_ids:A.required_fact_ids,
      mandatory_evidence_ids:A.mandatory_evidence_ids,
      target_evidence_id:target,
      hidden_missing_fact_ids:Ah.coverage.missing_fact_ids,
      negative_control_evidence_id:nonMandatory[0]??null,
      full_action_families:A.full_action_families,
      coverage_aware_action_families:A.coverage_aware_action_families
    }
  };
}

if(process.argv[1]?.endsWith('verify-formal-samples.mjs')){
 const p=process.argv[2]; if(!p){console.error("usage: node verify-formal-samples.mjs samples.jsonl [out.json]");process.exit(2);}
 const rows=fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const results=rows.map(verifyFormalSample);
 const out={schema_version:1,status:results.every(r=>r.pass)?"PASS":"FAIL",samples:results.length,results};
 if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(out,null,2)+'\n','utf8');
 console.log(JSON.stringify(out,null,2));
 if(out.status!=="PASS")process.exit(1);
}
