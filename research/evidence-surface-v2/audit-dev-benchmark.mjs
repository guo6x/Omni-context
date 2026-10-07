import crypto from 'node:crypto';
import { generateDevPairs, FAMILIES, DOMAINS } from './generate-dev-paired-worlds.mjs';
import { validatePair } from './validate-paired-world.mjs';
import { validatePairB } from './validate-paired-world-b.mjs';

function canonical(x){
  if(Array.isArray(x)) return x.map(canonical);
  if(x&&typeof x==='object') return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));
  return x;
}
function hash(x){return crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');}
function count(xs,fn){const m={};for(const x of xs){const k=fn(x);m[k]=(m[k]??0)+1;}return m;}
function tokens(pair){
  const p=pair.world_a.policy_input;
  const s=[p.question,...p.candidates.flatMap(c=>[c.label,c.action_family]),...p.evidence.flatMap(e=>[e.role,e.fact,e.currentness])].join(' ').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim().split(' ');
  const set=new Set();for(let i=0;i+2<s.length;i++)set.add(s.slice(i,i+3).join(' '));return set;
}
function jaccard(a,b){let inter=0;for(const x of a)if(b.has(x))inter++;return inter/(a.size+b.size-inter||1);}

export function auditDevPairs(pairs=generateDevPairs()){
  const ids=new Set(),surfaceHashes=new Map(),templateCounts=count(pairs,p=>p.construction_provenance.template_id);
  const familyCounts=count(pairs,p=>p.family),domainCounts=count(pairs,p=>p.construction_provenance.domain_id);
  const validation=[];
  let cleanCurrent=0;
  for(const p of pairs){
    const a=validatePair(p),b=validatePairB(p);
    validation.push({pair_id:p.pair_id,a_valid:a.valid,b_valid:b.valid,a_errors:a.errors,b_failures:b.failures});
    ids.add(p.pair_id);
    const h=hash(p.world_a.policy_input);
    if(!surfaceHashes.has(h)) surfaceHashes.set(h,[]);
    surfaceHashes.get(h).push(p.pair_id);
    if(p.world_a.policy_input.evidence.every(e=>e.currentness==='current')&&p.world_b.policy_input.evidence.every(e=>e.currentness==='current'))cleanCurrent++;
  }
  const duplicateSurfaces=[...surfaceHashes.entries()].filter(([,v])=>v.length>1).map(([h,v])=>({hash:h,pairs:v}));
  const repr=pairs.map(p=>({id:p.pair_id,t:tokens(p)}));
  let maxJ=0,maxPair=null;const near=[];
  for(let i=0;i<repr.length;i++)for(let j=i+1;j<repr.length;j++){
    const x=jaccard(repr[i].t,repr[j].t);
    if(x>maxJ){maxJ=x;maxPair=[repr[i].id,repr[j].id];}
    if(x>=0.90)near.push({a:repr[i].id,b:repr[j].id,jaccard:Number(x.toFixed(4))});
  }
  const maxTemplate=Math.max(...Object.values(templateCounts));
  return {
    schema_version:1,
    pairs:pairs.length,
    unique_pair_ids:ids.size,
    family_counts:familyCounts,
    domain_counts:domainCounts,
    template_counts:templateCounts,
    max_template_count:maxTemplate,
    max_template_concentration:Number((maxTemplate/pairs.length).toFixed(6)),
    all_validator_a_pass:validation.every(x=>x.a_valid),
    all_validator_b_pass:validation.every(x=>x.b_valid),
    clean_current_pairs:cleanCurrent,
    duplicate_surface_groups:duplicateSurfaces,
    near_duplicate_threshold:0.90,
    near_duplicate_pairs:near,
    max_word_trigram_jaccard:Number(maxJ.toFixed(6)),
    max_similarity_pair:maxPair,
    validation,
    gates:{
      pair_count_50:pairs.length===50,
      five_balanced_families:FAMILIES.every(f=>familyCounts[f]===10),
      ten_balanced_domains:DOMAINS.every(d=>domainCounts[d.id]===5),
      unique_ids:ids.size===pairs.length,
      no_cross_pair_exact_surface_duplicates:duplicateSurfaces.length===0,
      no_near_duplicates_at_090:near.length===0,
      template_concentration_le_10pct:maxTemplate/pairs.length<=0.10,
      all_clean_current:cleanCurrent===pairs.length,
      dual_validators_pass:validation.every(x=>x.a_valid&&x.b_valid)
    }
  };
}

if(process.argv[1]&&process.argv[1].endsWith('audit-dev-benchmark.mjs')){
  const r=auditDevPairs();
  console.log(JSON.stringify(r,null,2));
  if(!Object.values(r.gates).every(Boolean))process.exit(1);
}
