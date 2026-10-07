import fs from 'node:fs';

const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

function wordNgrams(text, n=3) {
  const words=normalize(text).split(/\s+/).filter(Boolean);
  const out=new Set();
  if(words.length<n){if(words.length)out.add(words.join(' '));return out;}
  for(let i=0;i<=words.length-n;i++) out.add(words.slice(i,i+n).join(' '));
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

export function auditDataset(samples, threshold=0.70) {
  const errors=[];
  const warnings=[];
  const ids=new Set();
  const familyCounts={};
  const domainCounts={};
  const templateCounts={};
  const exactText=new Map();

  for(const s of samples){
    if(ids.has(s.sample_id)) errors.push({type:'DUPLICATE_SAMPLE_ID',sample_id:s.sample_id});
    ids.add(s.sample_id);
    familyCounts[s.family]=(familyCounts[s.family]||0)+1;
    domainCounts[s.domain]=(domainCounts[s.domain]||0)+1;

    const template=s.construction_provenance?.template_id ?? 'missing';
    templateCounts[template]=(templateCounts[template]||0)+1;

    const normalized=normalize(sampleText(s));
    if(exactText.has(normalized)) errors.push({type:'EXACT_TEXT_DUPLICATE',a:exactText.get(normalized),b:s.sample_id});
    else exactText.set(normalized,s.sample_id);

    const target=s.constructor_proposal?.treatment_target_evidence_id;
    const ev=(s.evidence||[]).find(x=>x.evidence_id===target);
    if(!ev) errors.push({type:'TREATMENT_TARGET_MISSING',sample_id:s.sample_id,target});

    const promptText=normalize(s.question);
    if(target && promptText.includes(normalize(target))) errors.push({type:'TARGET_ID_IN_QUESTION',sample_id:s.sample_id,target});
    if(ev && normalize(ev.fact).length>=8 && promptText.includes(normalize(ev.fact))) errors.push({type:'TARGET_FACT_VERBATIM_IN_QUESTION',sample_id:s.sample_id,target});
  }

  const fingerprints=samples.map(s=>({sample_id:s.sample_id,family:s.family,domain:s.domain,grams:wordNgrams(sampleText(s),3)}));
  for(let i=0;i<fingerprints.length;i++){
    for(let j=i+1;j<fingerprints.length;j++){
      const score=jaccard(fingerprints[i].grams,fingerprints[j].grams);
      if(score>=threshold){
        warnings.push({
          type:'NEAR_DUPLICATE_WORD_TRIGRAM',
          a:fingerprints[i].sample_id,b:fingerprints[j].sample_id,
          same_family:fingerprints[i].family===fingerprints[j].family,
          same_domain:fingerprints[i].domain===fingerprints[j].domain,
          jaccard:Number(score.toFixed(4))
        });
      }
    }
  }

  const maxTemplateCount=Math.max(0,...Object.values(templateCounts));
  const maxTemplateFraction=samples.length?maxTemplateCount/samples.length:0;
  if(maxTemplateFraction>0.10){
    errors.push({type:'PROMPT_TEMPLATE_CONCENTRATION',max_template_count:maxTemplateCount,max_template_fraction:maxTemplateFraction});
  }

  return {
    schema_version:2,
    n_samples:samples.length,
    family_counts:familyCounts,
    domain_counts:domainCounts,
    template_count:Object.keys(templateCounts).length,
    max_template_count:maxTemplateCount,
    max_template_fraction:Number(maxTemplateFraction.toFixed(4)),
    near_duplicate_metric:'word-trigram Jaccard',
    near_duplicate_threshold:threshold,
    errors,warnings,
    pass:errors.length===0 && warnings.length===0
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
