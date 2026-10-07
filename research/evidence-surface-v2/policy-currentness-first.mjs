const HARD_NONCURRENT=new Set(['stale','superseded']);

function fallback(reason){
  return {action_family:'DEFER',selected_candidate_id:null,decisive:false,reason};
}

function timestampMs(e){
  const t=Date.parse(e?.at??'');
  return Number.isFinite(t)?t:null;
}

function latestRecord(records){
  if(records.length===0) return null;
  if(records.length===1) return records[0];
  const timed=records.map(e=>({e,t:timestampMs(e)})).filter(x=>x.t!==null);
  if(timed.length!==records.length) return null;
  timed.sort((a,b)=>b.t-a.t||String(a.e.evidence_id).localeCompare(String(b.e.evidence_id)));
  if(timed.length>1 && timed[0].t===timed[1].t) return null;
  return timed[0].e;
}

function directCandidateDecision(record,candidates,reason,fallbackFamily){
  const ids=record?.supports_candidates??[];
  if(ids.length!==1) return null;
  const winner=(candidates??[]).find(x=>x.candidate_id===ids[0]);
  if(!winner) return null;
  return {
    action_family:winner.action_family??fallbackFamily,
    selected_candidate_id:winner.candidate_id,
    decisive:true,
    reason
  };
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
    const latest=latestRecord(currentOverride);
    if(latest){
      const d=directCandidateDecision(latest,candidates,'LATEST_CURRENT_OVERRIDE','HONOR_OVERRIDE');
      if(d) return d;
    }
    const supported=[...new Set(currentOverride.flatMap(e=>e.supports_candidates??[]))];
    if(supported.length===1){
      const winner=(candidates??[]).find(x=>x.candidate_id===supported[0]);
      return {action_family:winner?.action_family??'HONOR_OVERRIDE',selected_candidate_id:supported[0],decisive:true,reason:'CURRENT_OVERRIDE'};
    }
    return fallback('AMBIGUOUS_OVERRIDE');
  }

  const currentResolution=visible.filter(e=>e.role==='conflict_resolution' && e.currentness==='current');
  const conflictClaims=visible.filter(e=>e.role==='conflict_claim' && e.currentness==='current');
  if(currentResolution.length){
    const latest=latestRecord(currentResolution);
    if(latest){
      const d=directCandidateDecision(latest,candidates,'LATEST_CONFLICT_RESOLUTION','DECIDE');
      if(d) return d;
    } else if(currentResolution.length===1){
      const d=directCandidateDecision(currentResolution[0],candidates,'CURRENT_CONFLICT_RESOLUTION','DECIDE');
      if(d) return d;
    }
  }
  if(conflictClaims.length>=2 && currentResolution.length===0) return fallback('UNRESOLVED_CONFLICT');

  const authorityRequirements=visible.filter(e=>e.role==='authority' && (e.supports_candidates??[]).length===0);
  const authorityGrants=visible.filter(e=>e.role==='authority' && (e.supports_candidates??[]).length>0 && e.currentness==='current');
  if(authorityRequirements.length>0 && authorityGrants.length===0) return fallback('AUTHORITY_NOT_SHOWN');

  const outcomes=visible.filter(e=>e.role==='outcome' && e.currentness==='current');
  if(outcomes.length){
    const latest=latestRecord(outcomes)??(outcomes.length===1?outcomes[0]:null);
    if(latest){
      const d=directCandidateDecision(latest,candidates,'LATEST_CURRENT_OUTCOME','REVISE_OR_INVALIDATE');
      if(d) return d;
    }
  }

  const best=bestCandidate(visible,candidates??[]);
  if(!best || best[1]<=0) return fallback('NO_POSITIVE_VISIBLE_SUPPORT');

  const winner=(candidates??[]).find(x=>x.candidate_id===best[0]);
  return {action_family:winner?.action_family??'DECIDE',selected_candidate_id:best[0],decisive:true,reason:'VISIBLE_EVIDENCE_VOTE'};
}
