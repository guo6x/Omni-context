import fs from 'node:fs';

const normalize = (s) => String(s || '').toLowerCase().replace(/\s+/g,' ').trim();

function ngrams(text, n=8) {
  const s=normalize(text);
  const out=new Set();
  if (s.length < n) { if (s) out.add(s); return out; }
  for(let i=0;i<=s.length-n;i++) out.add(s.slice(i,i+n));
  return out;
}

function jaccard(A,B) {
  const U=new Set([...A,...B]);
  if(!U.size) return 1;
  let I=0; for(const x of A) if(B.has(x)) I++;
  return I/U.size;
}

function sampleText(s) {
  return [
    s.question,
    ...(s.source_events||[]).map(x=>x.content),
    ...(s.candidates||[]).flatMap(x=>[x.label,x.description]),
    ...(s.evidence||[]).map(x=>x.fact)
  ].join(' ');
}

export function auditDataset(samples, threshold=0.50) {
  const errors=[];
  const warnings=[];
  const ids=new Set();
  const familyCounts={};
  const domainCounts={};

  for(const s of samples){
    if(ids.has(s.sample_id)) errors.push({type:'DUPLICATE_SAMPLE_ID',sample_id:s.sample_id});
    ids.add(s.sample_id);
    familyCounts[s.family]=(familyCounts[s.family]||0)+1;
    domainCounts[s.domain]=(domainCounts[s.domain]||0)+1;

    const target=s.constructor_proposal?.treatment_target_evidence_id;
    const ev=(s.evidence||[]).find(x=>x.evidence_id===target);
    if(!ev) errors.push({type:'TREATMENT_TARGET_MISSING',sample_id:s.sample_id,target});

    const promptText=normalize(s.question);
    if(target && promptText.includes(normalize(target))) {
      errors.push({type:'TARGET_ID_IN_QUESTION',sample_id:s.sample_id,target});
    }
    if(ev && normalize(ev.fact).length>=8 && promptText.includes(normalize(ev.fact))) {
      errors.push({type:'TARGET_FACT_VERBATIM_IN_QUESTION',sample_id:s.sample_id,target});
    }
  }

  const fingerprints=samples.map(s=>({sample_id:s.sample_id,family:s.family,grams:ngrams(sampleText(s),8)}));
  for(let i=0;i<fingerprints.length;i++){
    for(let j=i+1;j<fingerprints.length;j++){
      const score=jaccard(fingerprints[i].grams,fingerprints[j].grams);
      if(score>=threshold){
        warnings.push({
          type:'NEAR_DUPLICATE',
          a:fingerprints[i].sample_id,
          b:fingerprints[j].sample_id,
          same_family:fingerprints[i].family===fingerprints[j].family,
          jaccard:Number(score.toFixed(4))
        });
      }
    }
  }

  return {
    schema_version:1,
    n_samples:samples.length,
    family_counts:familyCounts,
    domain_counts:domainCounts,
    near_duplicate_threshold:threshold,
    errors,
    warnings,
    pass:errors.length===0
  };
}

if(process.argv[1] && process.argv[1].endsWith('audit-p1-dataset.mjs')){
  const [input,out]=process.argv.slice(2);
  if(!input){console.error('usage: node audit-p1-dataset.mjs samples.jsonl [report.json]');process.exit(2);}
  const rows=fs.readFileSync(input,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const report=auditDataset(rows);
  if(out) fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n','utf8');
  console.log(JSON.stringify(report,null,2));
  if(!report.pass) process.exit(1);
}
