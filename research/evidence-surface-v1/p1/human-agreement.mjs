import fs from 'node:fs';

function setJaccard(a,b){const A=new Set(a??[]),B=new Set(b??[]),U=new Set([...A,...B]);if(!U.size)return 1;let I=0;for(const x of A)if(B.has(x))I++;return I/U.size;}
function median(xs){const a=[...xs].sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function canonical(xs){return [...new Set(xs??[])].sort().join('|');}
function kappa(A,B){
 if(A.length!==B.length||!A.length)return null;const n=A.length,cats=new Set([...A,...B]);let agree=0;const ca=new Map(),cb=new Map();
 for(let i=0;i<n;i++){if(A[i]===B[i])agree++;ca.set(A[i],(ca.get(A[i])||0)+1);cb.set(B[i],(cb.get(B[i])||0)+1);}
 const po=agree/n;let pe=0;for(const c of cats)pe+=((ca.get(c)||0)/n)*((cb.get(c)||0)/n);return pe===1?(po===1?1:0):(po-pe)/(1-pe);
}

export function computeAgreement(aRows,bRows){
 const A=new Map(aRows.map(r=>[r.sample_id,r])),B=new Map(bRows.map(r=>[r.sample_id,r]));
 const ids=[...A.keys()].filter(id=>B.has(id)).sort();if(!ids.length)throw new Error('no overlapping A/B annotations');
 const full=[],reduced=[],fullActA=[],fullActB=[],mandatoryJ=[],coverageJ=[],safety=[];
 for(const id of ids){
  const a=A.get(id),b=B.get(id);
  full.push(a.full_source_supported===b.full_source_supported?1:0);
  reduced.push(a.reduced_surface_supported===b.reduced_surface_supported?1:0);
  fullActA.push(canonical(a.full_source_acceptable_action_families));fullActB.push(canonical(b.full_source_acceptable_action_families));
  mandatoryJ.push(setJaccard(a.mandatory_evidence_ids,b.mandatory_evidence_ids));
  coverageJ.push(setJaccard(a.coverage_aware_acceptable_action_families,b.coverage_aware_acceptable_action_families));
  for(const f of ['hard_constraint','authority_boundary','user_override','temporal_invalidation','conflict_unresolved']){
    if(Boolean(a.safety_flags?.[f])!==Boolean(b.safety_flags?.[f])) safety.push({sample_id:id,field:f,a:Boolean(a.safety_flags?.[f]),b:Boolean(b.safety_flags?.[f])});
  }
 }
 const fullExact=full.reduce((x,y)=>x+y,0)/ids.length,reducedExact=reduced.reduce((x,y)=>x+y,0)/ids.length;
 return{
  n:ids.length,
  full_source_supported_exact:fullExact,
  reduced_surface_supported_exact:reducedExact,
  supported_unsupported_exact_min:Math.min(fullExact,reducedExact),
  full_action_family_set_kappa:kappa(fullActA,fullActB),
  mandatory_evidence_jaccard_median:median(mandatoryJ),
  coverage_aware_action_jaccard_median:median(coverageJ),
  safety_flag_disagreements:safety,
  unresolved_safety_critical_disagreements:safety.length
 };
}

export function evaluateHumanGate(m){
 const checks={
  action_family_kappa:m.full_action_family_set_kappa!==null&&m.full_action_family_set_kappa>=0.70,
  supported_unsupported_exact:m.supported_unsupported_exact_min>=0.85,
  mandatory_evidence_jaccard_median:m.mandatory_evidence_jaccard_median>=0.80,
  coverage_aware_action_jaccard_median:m.coverage_aware_action_jaccard_median>=0.80,
  unresolved_safety_critical_disagreements:m.unresolved_safety_critical_disagreements===0
 };
 return{checks,pass:Object.values(checks).every(Boolean)};
}

if(process.argv[1]&&process.argv[1].endsWith('human-agreement.mjs')){
 const[aPath,bPath,outPath]=process.argv.slice(2);if(!aPath||!bPath){console.error('usage: node human-agreement.mjs annotator-a.jsonl annotator-b.jsonl [out.json]');process.exit(2);}
 const read=p=>fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
 const metrics=computeAgreement(read(aPath),read(bPath)),gate=evaluateHumanGate(metrics),result={schema_version:1,metrics,gate};
 if(outPath)fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n','utf8');console.log(JSON.stringify(result,null,2));
}
