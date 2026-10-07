const ACTIONS=new Set(["DECIDE","PROPOSE_CONFIRM","CLARIFY","DEFER","REQUEST_APPROVAL","REVISE_OR_INVALIDATE","HONOR_OVERRIDE","REFUSE"]);

const sorted=x=>[...x].sort();

function coverage(sample, visibleEvidenceIds){
  const visible=new Set(visibleEvidenceIds);
  const covered=new Set();
  for(const e of sample.evidence){
    if(!visible.has(e.evidence_id)) continue;
    for(const fid of e.world_fact_ids??[]) covered.add(fid);
  }
  const required=new Set(sample.world_spec.decision_contract.required_fact_ids);
  const missing=[...required].filter(fid=>!covered.has(fid)).sort();
  return {complete:missing.length===0,covered_fact_ids:sorted(covered),missing_fact_ids:missing};
}

export function evaluateFormalA(sample, visibleEvidenceIds=sample.evidence.map(e=>e.evidence_id)){
  const c=sample.world_spec.decision_contract;
  const fullIds=sample.evidence.map(e=>e.evidence_id);
  const mandatory=[];
  for(const e of sample.evidence){
    const after=fullIds.filter(id=>id!==e.evidence_id);
    if(!coverage(sample,after).complete) mandatory.push(e.evidence_id);
  }
  return {
    required_fact_ids:sorted(c.required_fact_ids),
    full_action_families:sorted(c.full_action_families),
    coverage_aware_action_families:sorted(c.coverage_aware_action_families),
    mandatory_evidence_ids:sorted(mandatory),
    coverage:coverage(sample,visibleEvidenceIds)
  };
}

export function assertActionVocabulary(sample){
  const vals=[
    ...(sample.world_spec?.decision_contract?.full_action_families??[]),
    ...(sample.world_spec?.decision_contract?.coverage_aware_action_families??[])
  ];
  return vals.every(a=>ACTIONS.has(a));
}
