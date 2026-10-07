const FAMILY_RULES={
 F1:{required_kinds:["constraint_requirement","candidate_feasibility"],full:["DECIDE"],coverage:["CLARIFY","DEFER"]},
 F2:{required_kinds:["authority_requirement","authorization_grant"],full:["DECIDE"],coverage:["DEFER","REQUEST_APPROVAL"]},
 F3:{required_kinds:["current_state"],full:["DECIDE"],coverage:["CLARIFY","DEFER"]},
 F4:{required_kinds:["conflict_resolution"],full:["DECIDE"],coverage:["CLARIFY","DEFER"]},
 F5:{required_kinds:["outcome_change"],full:["REVISE_OR_INVALIDATE"],coverage:["CLARIFY","DEFER"]},
 F6:{required_kinds:["current_override"],full:["HONOR_OVERRIDE"],coverage:["CLARIFY","DEFER"]}
};
const sorted=x=>[...x].sort();

function requiredFactsByFamily(sample){
  const rule=FAMILY_RULES[sample.family];
  if(!rule) throw new Error(sample.sample_id+": unknown family");
  const ids=[];
  for(const kind of rule.required_kinds){
    const matches=sample.world_spec.facts.filter(f=>f.kind===kind && f.current!==false);
    if(matches.length!==1) throw new Error(sample.sample_id+": expected exactly one current "+kind+", got "+matches.length);
    ids.push(matches[0].fact_id);
  }
  return ids;
}

function coverageFromFacts(sample, requiredFactIds, visibleEvidenceIds){
  const visible=new Set(visibleEvidenceIds),covered=new Set();
  for(const e of sample.evidence){
    if(!visible.has(e.evidence_id)) continue;
    for(const fid of e.world_fact_ids??[]) covered.add(fid);
  }
  const missing=requiredFactIds.filter(fid=>!covered.has(fid)).sort();
  return {complete:missing.length===0,missing_fact_ids:missing,covered_fact_ids:sorted(covered)};
}

export function evaluateFormalB(sample, visibleEvidenceIds=sample.evidence.map(e=>e.evidence_id)){
  const rule=FAMILY_RULES[sample.family];
  const required=requiredFactsByFamily(sample);
  const fullIds=sample.evidence.map(e=>e.evidence_id),mandatory=[];
  for(const e of sample.evidence){
    if(!coverageFromFacts(sample,required,fullIds.filter(id=>id!==e.evidence_id)).complete) mandatory.push(e.evidence_id);
  }
  return {
    required_fact_ids:sorted(required),
    full_action_families:sorted(rule.full),
    coverage_aware_action_families:sorted(rule.coverage),
    mandatory_evidence_ids:sorted(mandatory),
    coverage:coverageFromFacts(sample,required,visibleEvidenceIds)
  };
}

export { FAMILY_RULES };
