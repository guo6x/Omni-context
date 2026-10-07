export function acquisitionLedgerMonitor(ctx){
  const reasons=[];
  const byId=new Map((ctx?.channels??[]).map(x=>[x.channel_id,x]));
  for(const id of ctx?.required_channels??[]){
    const ch=byId.get(id);
    if(!ch){reasons.push('MISSING_CHANNEL:'+id);continue;}
    if(ch.index_complete!==true) reasons.push('INDEX_INCOMPLETE:'+id);
    if(ch.retrieval_complete!==true) reasons.push('RETRIEVAL_INCOMPLETE:'+id);
    if(ch.retrieved_head_seq<ch.source_head_seq) reasons.push('SOURCE_AHEAD:'+id);
    if(ch.retrieved_head_seq>ch.source_head_seq) reasons.push('HEAD_INCONSISTENT:'+id);
  }
  return {status:reasons.length?'INCOMPLETE':'COMPLETE',reasons};
}

export function surfaceOnlyMonitor(policyInput){
  const suspicious=(policyInput?.evidence??[]).filter(e=>
    ['unknown','stale','superseded'].includes(e.currentness)
  );
  return suspicious.length
    ? {status:'INCOMPLETE',reasons:suspicious.map(e=>'NONCURRENT:'+e.evidence_id)}
    : {status:'COMPLETE',reasons:[]};
}
