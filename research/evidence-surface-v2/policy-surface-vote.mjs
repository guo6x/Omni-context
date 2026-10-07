export function surfaceVotePolicy(input){
  const candidates=input?.candidates??[];
  const evidence=input?.evidence??[];
  const scores=new Map(candidates.map(c=>[c.candidate_id,0]));
  for(const e of evidence){
    for(const id of e.supports_candidates??[]){
      if(scores.has(id)) scores.set(id,scores.get(id)+1);
    }
  }
  const winner=[...scores.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0];
  if(!winner||winner[1]<=0){
    return {decisive:false,action_family:'DEFER',selected_candidate_id:null,reason:'NO_POSITIVE_VISIBLE_SUPPORT'};
  }
  const c=candidates.find(x=>x.candidate_id===winner[0]);
  return {
    decisive:true,
    action_family:c?.action_family??'DECIDE',
    selected_candidate_id:winner[0],
    reason:'VISIBLE_SUPPORT_VOTE'
  };
}
