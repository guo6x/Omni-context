import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateConfirmatoryPairs, FAMILIES, DOMAINS, REGIMES } from './generate-confirmatory-paired-worlds.mjs';
import { generateDevPairs } from './generate-dev-paired-worlds.mjs';
import { validatePair } from './validate-paired-world.mjs';
import { validatePairB } from './validate-paired-world-b.mjs';

function canonical(x){
  if(Array.isArray(x)) return x.map(canonical);
  if(x&&typeof x==='object') return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));
  return x;
}
const stable=x=>JSON.stringify(canonical(x));
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:stable(x)).digest('hex');
function count(xs,fn){const m={};for(const x of xs){const k=fn(x);m[k]=(m[k]??0)+1;}return Object.fromEntries(Object.entries(m).sort());}
function trigramSet(pair){
  const p=pair.world_a.policy_input;
  const toks=[p.question,...p.candidates.flatMap(c=>[c.label,c.action_family]),...p.evidence.flatMap(e=>[e.role,e.fact,e.currentness])]
    .join(' ').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim().split(' ');
  const s=new Set();for(let i=0;i+2<toks.length;i++)s.add(toks.slice(i,i+3).join(' '));return s;
}
function jac(a,b){let n=0;for(const x of a)if(b.has(x))n++;return n/(a.size+b.size-n||1);}
function forbiddenOutcomeKeys(x,pathSoFar='root',hits=[]){
  const banned=new Set(['monitor_status','policy_output','world_action_violation','correct_decisive','wavr','fedd','udr','model_response','llm_output']);
  if(Array.isArray(x)){x.forEach((v,i)=>forbiddenOutcomeKeys(v,pathSoFar+'['+i+']',hits));return hits;}
  if(x&&typeof x==='object'){
    for(const [k,v] of Object.entries(x)){
      if(banned.has(k))hits.push(pathSoFar+'.'+k);
      forbiddenOutcomeKeys(v,pathSoFar+'.'+k,hits);
    }
  }
  return hits;
}
function maxSimilarity(A,B,self=false){
  const aa=A.map(p=>({id:p.pair_id,set:trigramSet(p)})),bb=B.map(p=>({id:p.pair_id,set:trigramSet(p)}));
  let max=0,pair=null;const near=[];
  for(let i=0;i<aa.length;i++)for(let j=0;j<bb.length;j++){
    if(self&&j<=i)continue;
    const v=jac(aa[i].set,bb[j].set);
    if(v>max){max=v;pair=[aa[i].id,bb[j].id];}
    if(v>=0.80)near.push({a:aa[i].id,b:bb[j].id,jaccard:Number(v.toFixed(4))});
  }
  return {max:Number(max.toFixed(6)),pair,near};
}

export function auditConfirmatory(pairs=generateConfirmatoryPairs()){
  const dev=generateDevPairs();
  const family=count(pairs,p=>p.family),domain=count(pairs,p=>p.construction_provenance.domain_id);
  const regime=count(pairs,p=>p.construction_provenance.acquisition_regime);
  const familyRegime=count(pairs,p=>p.family+'::'+p.construction_provenance.acquisition_regime);
  const template=count(pairs,p=>p.construction_provenance.template_id);
  const ids=new Set(pairs.map(p=>p.pair_id));
  const surfaces=new Map();
  const validations=[];
  let clean=0;
  const forbidden=[];
  for(const p of pairs){
    const a=validatePair(p),b=validatePairB(p);
    validations.push({pair_id:p.pair_id,a_valid:a.valid,b_valid:b.valid,a_errors:a.errors,b_failures:b.failures});
    const h=sha(p.world_a.policy_input);
    if(!surfaces.has(h))surfaces.set(h,[]);
    surfaces.get(h).push(p.pair_id);
    if(p.world_a.policy_input.evidence.every(e=>e.currentness==='current')&&p.world_b.policy_input.evidence.every(e=>e.currentness==='current'))clean++;
    forbidden.push(...forbiddenOutcomeKeys(p,p.pair_id));
  }
  const dup=[...surfaces.entries()].filter(([,v])=>v.length>1).map(([hash,pairs])=>({hash,pairs}));
  const within=maxSimilarity(pairs,pairs,true);
  const cross=maxSimilarity(pairs,dev,false);
  const maxTemplate=Math.max(...Object.values(template));
  const corpusText=pairs.map(x=>JSON.stringify(x)).join('\n')+'\n';
  const gates={
    exactly_100_pairs:pairs.length===100,
    five_families_balanced:FAMILIES.every(f=>family[f]===20),
    twenty_domains_balanced:DOMAINS.every(d=>domain[d.id]===5),
    four_regimes_balanced:REGIMES.every(r=>regime[r]===25),
    each_family_has_five_per_regime:FAMILIES.every(f=>REGIMES.every(r=>familyRegime[f+'::'+r]===5)),
    unique_ids:ids.size===pairs.length,
    dual_validators_pass:validations.every(v=>v.a_valid&&v.b_valid),
    all_clean_current:clean===pairs.length,
    no_exact_surface_duplicates:dup.length===0,
    no_within_near_duplicate_at_080:within.near.length===0,
    no_cross_dev_near_duplicate_at_080:cross.near.length===0,
    template_concentration_le_05:maxTemplate/pairs.length<=0.05,
    no_outcome_keys_embedded:forbidden.length===0
  };
  return {
    schema_version:1,
    purpose:'confirmatory benchmark construction audit only; no policy, monitor, retriever, or model outcomes',
    pairs:pairs.length,
    family_counts:family,
    domain_counts:domain,
    acquisition_regime_counts:regime,
    family_regime_counts:familyRegime,
    template_counts:template,
    max_template_concentration:Number((maxTemplate/pairs.length).toFixed(6)),
    clean_current_pairs:clean,
    exact_surface_duplicate_groups:dup,
    within_confirmatory_similarity:{threshold:0.80,max_word_trigram_jaccard:within.max,max_pair:within.pair,near_pairs:within.near},
    cross_dev_similarity:{threshold:0.80,max_word_trigram_jaccard:cross.max,max_pair:cross.pair,near_pairs:cross.near},
    forbidden_outcome_key_hits:forbidden,
    corpus_sha256:sha(corpusText),
    validations,
    gates
  };
}

const isMain=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
  const r=auditConfirmatory();
  if(process.argv[2]){
    const out=path.resolve(process.argv[2]);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n');
  }
  console.log(JSON.stringify({status:Object.values(r.gates).every(Boolean)?'PASS':'FAIL',pairs:r.pairs,corpus_sha256:r.corpus_sha256,within:r.within_confirmatory_similarity,cross_dev:r.cross_dev_similarity,gates:r.gates},null,2));
  if(!Object.values(r.gates).every(Boolean))process.exit(1);
}
