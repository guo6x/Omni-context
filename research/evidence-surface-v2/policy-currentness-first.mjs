const HARD_NONCURRENT=new Set(['stale','superseded']);

function fallback(reason){
  return {action_family:'DEFER',selected_candidate_id:null,decisive:false,reason};
}

function bestCandidate(evidence,candidates){
  const score=new Map(candidates.map(c=>[c.candidate_id,0]));
  for(const e of evidence){
    if(e.role==='stale_fact') continue;
    if(HARD_NONCURRENT.has(e.currentness)) continue;
    const weight =
      e.role==='override' ? 8 :
      e.role==='conflict_resolution' ? 6 :
      e.role==='outcome' ? 5 :
      e.role==='authority' ? 4 :
      e.role==='current_fact' ? 3 :
      e.role==='constraint' ? 2 :
      e.role==='conflict_claim' ? 1 :
      e.role==='preference' ? 0.5 : 1;
    for(const id of e.supports_candidates??[]){
      if(score.has(id)) score.set(id,score.get(id)+weight);
    }
  }
  return [...score.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]??null;
}

export function currentnessFirstPolicy({evidence,candidates}){
  const visible=evidence??[];

  // A record semantically presented as a current fact must not itself be marked
  // stale/superseded. This is the V1 F6 cue that the original frozen policy ignored.
  const contradictoryCurrent=visible.filter(e=>
    e.role==='current_fact' && HARD_NONCURRENT.has(e.currentness)
  );
  if(contradictoryCurrent.length){
    return fallback('NONCURRENT_CURRENT_FACT:'+contradictoryCurrent.map(e=>e.evidence_id).join(','));
  }

  const currentOverride=visible.filter(e=>e.role==='override' && e.currentness==='current');
  if(currentOverride.length){
    const supported=[...new Set(currentOverride.flatMap(e=>e.supports_candidates??[]))];
    if(supported.length===1){
      const winner=(candidates??[]).find(x=>x.candidate_id===supported[0]);
      return {action_family:winner?.action_family??'HONOR_OVERRIDE',selected_candidate_id:supported[0],decisive:true,reason:'CURRENT_OVERRIDE'};
    }
    return fallback('AMBIGUOUS_OVERRIDE');
  }

  const currentResolution=visible.filter(e=>e.role==='conflict_resolution' && e.currentness==='current');
  const conflictClaims=visible.filter(e=>e.role==='conflict_claim' && e.currentness==='current');
  if(conflictClaims.length>=2 && currentResolution.length===0) return fallback('UNRESOLVED_CONFLICT');

  const authorityRequirements=visible.filter(e=>e.role==='authority' && (e.supports_candidates??[]).length===0);
  const authorityGrants=visible.filter(e=>e.role==='authority' && (e.supports_candidates??[]).length>0 && e.currentness==='current');
  if(authorityRequirements.length>0 && authorityGrants.length===0) return fallback('AUTHORITY_NOT_SHOWN');

  const outcome=visible.find(e=>e.role==='outcome' && e.currentness==='current');
  if(outcome){
    const ids=outcome.supports_candidates??[];
    if(ids.length===1){
      const winner=(candidates??[]).find(x=>x.candidate_id===ids[0]);
      return {action_family:winner?.action_family??'REVISE_OR_INVALIDATE',selected_candidate_id:ids[0],decisive:true,reason:'CURRENT_OUTCOME'};
    }
  }

  const best=bestCandidate(visible,candidates??[]);
  if(!best || best[1]<=0) return fallback('NO_POSITIVE_VISIBLE_SUPPORT');

  const winner=(candidates??[]).find(x=>x.candidate_id===best[0]);
  return {action_family:winner?.action_family??'DECIDE',selected_candidate_id:best[0],decisive:true,reason:'VISIBLE_EVIDENCE_VOTE'};
}
