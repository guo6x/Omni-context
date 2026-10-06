import fs from 'node:fs';

export function checkRendererConsistency(sample){
  const errors=[];
  const sourceById=new Map((sample.source_events??[]).map(x=>[x.event_id,x]));
  const factById=new Map((sample.world_spec?.facts??[]).map(x=>[x.fact_id,x]));
  const evidenceByFact=new Map();

  if((sample.source_events??[]).length!==(sample.world_spec?.facts??[]).length){
    errors.push('source-event/world-fact count mismatch');
  }
  if((sample.evidence??[]).length!==(sample.world_spec?.facts??[]).length){
    errors.push('evidence/world-fact count mismatch');
  }

  for(const e of sample.evidence??[]){
    if(!Array.isArray(e.world_fact_ids)||e.world_fact_ids.length!==1){
      errors.push(`${e.evidence_id}: expected exactly one world_fact_id`);
      continue;
    }
    const fid=e.world_fact_ids[0], f=factById.get(fid);
    if(!f){errors.push(`${e.evidence_id}: missing world fact ${fid}`);continue;}
    if(evidenceByFact.has(fid))errors.push(`${fid}: mapped by multiple evidence items`);
    evidenceByFact.set(fid,e.evidence_id);
    if(e.source_event_id!==f.source_event_id)errors.push(`${e.evidence_id}: source_event_id differs from world fact`);
    if(e.fact!==f.statement)errors.push(`${e.evidence_id}: evidence text differs from world-fact statement`);
    const src=sourceById.get(e.source_event_id);
    if(!src)errors.push(`${e.evidence_id}: source event missing`);
    else{
      if(src.content!==f.statement)errors.push(`${e.evidence_id}: source content differs from world-fact statement`);
      if(src.at!==e.at)errors.push(`${e.evidence_id}: source/evidence timestamp mismatch`);
    }
    if(f.candidate_id){
      if(!(e.supports_candidates??[]).includes(f.candidate_id)) errors.push(`${e.evidence_id}: candidate support missing ${f.candidate_id}`);
    }
  }

  for(const f of sample.world_spec?.facts??[]){
    if(!evidenceByFact.has(f.fact_id))errors.push(`${f.fact_id}: no evidence rendering`);
  }

  const target=sample.constructor_proposal?.treatment_target_evidence_id;
  const te=(sample.evidence??[]).find(e=>e.evidence_id===target);
  if(te && sample.question.includes(te.fact))errors.push('question repeats target fact verbatim');

  const required=new Set(sample.world_spec?.decision_contract?.required_fact_ids??[]);
  for(const fid of required){
    if(!factById.has(fid))errors.push(`required fact missing: ${fid}`);
    if(!evidenceByFact.has(fid))errors.push(`required fact has no evidence: ${fid}`);
  }

  return {sample_id:sample.sample_id,pass:errors.length===0,errors};
}

if(process.argv[1]?.endsWith('check-renderer-consistency.mjs')){
  const p=process.argv[2];if(!p){console.error('usage: node check-renderer-consistency.mjs samples.jsonl [out.json]');process.exit(2);}
  const rows=fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const results=rows.map(checkRendererConsistency);
  const out={schema_version:1,status:results.every(x=>x.pass)?'PASS':'FAIL',samples:results.length,errors:results.flatMap(x=>x.errors.map(e=>({sample_id:x.sample_id,error:e}))),results};
  if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(out,null,2)+'\n','utf8');
  console.log(JSON.stringify(out,null,2));
  if(out.status!=='PASS')process.exit(1);
}
