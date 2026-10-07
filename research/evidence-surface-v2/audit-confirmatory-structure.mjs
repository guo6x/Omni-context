import crypto from 'node:crypto';
import { generateConfirmatoryCandidate, CONFIRMATORY_FAMILIES, CONFIRMATORY_DOMAINS, LEDGER_PROFILES } from './generate-confirmatory-candidate.mjs';
import { generateDevPairs } from './generate-dev-paired-worlds.mjs';
import { validatePair } from './validate-paired-world.mjs';
import { validatePairB } from './validate-paired-world-b.mjs';

function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
function hash(x){return crypto.createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');}
function count(xs,fn){const m={};for(const x of xs){const k=fn(x);m[k]=(m[k]??0)+1;}return m;}
function textSet(p){
  const x=p.world_a.policy_input;
  const words=[x.question,...x.candidates.flatMap(c=>[c.label,c.action_family]),...x.evidence.flatMap(e=>[e.role,e.fact,e.currentness])].join(' ').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim().split(' ');
  const s=new Set();for(let i=0;i+2<words.length;i++)s.add(words.slice(i,i+3).join(' '));return s;
}
function jac(a,b){let n=0;for(const x of a)if(b.has(x))n++;return n/(a.size+b.size-n||1);}

function profileShape(pair){
  const p=pair.construction_provenance.ledger_profile;
  const a=pair.world_a.acquisition_context.channels[0],b=pair.world_b.acquisition_context.channels[0];
  const aTruth=pair.world_a.hidden_state.surface_complete_truth,bTruth=pair.world_b.hidden_state.surface_complete_truth;
  if(aTruth!==true||bTruth!==false)return false;
  if(p==='L0_CLEAN_TRACKED')return a.source_head_seq===a.retrieved_head_seq&&b.source_head_seq===b.retrieved_head_seq+1;
  if(p==='L1_BENIGN_ADVANCE')return a.source_head_seq===a.retrieved_head_seq+1&&b.source_head_seq===b.retrieved_head_seq+1;
  if(p==='L2_STALE_SOURCE_HEAD')return a.source_head_seq===a.retrieved_head_seq&&b.source_head_seq===b.retrieved_head_seq;
  if(p==='L3_UNTRACKED_CHANNEL'){
    const required=new Set(pair.world_b.acquisition_context.required_channels);
    const hidden=pair.world_b.hidden_state.hidden_events[0]?.channel_id;
    return a.source_head_seq===a.retrieved_head_seq&&b.source_head_seq===b.retrieved_head_seq&&hidden&&!required.has(hidden);
  }
  return false;
}

export function auditConfirmatoryStructure(pairs=generateConfirmatoryCandidate()){
  const dev=generateDevPairs();
  const family=count(pairs,p=>p.family),domain=count(pairs,p=>p.construction_provenance.domain_id),profile=count(pairs,p=>p.construction_provenance.ledger_profile),template=count(pairs,p=>p.construction_provenance.template_id);
  const validation=pairs.map(p=>({id:p.pair_id,a:validatePair(p),b:validatePairB(p)}));
  const surfaceHashes=count(pairs,p=>hash(p.world_a.policy_input));
  const exactDup=Object.entries(surfaceHashes).filter(([,n])=>n>1);
  const confirmSets=pairs.map(p=>({id:p.pair_id,set:textSet(p)}));
  const devSets=dev.map(p=>({id:p.pair_id,set:textSet(p)}));
  let maxWithin=0,maxWithinPair=null,maxCross=0,maxCrossPair=null;
  const nearWithin=[],crossLeak=[];
  for(let i=0;i<confirmSets.length;i++)for(let j=i+1;j<confirmSets.length;j++){
    const v=jac(confirmSets[i].set,confirmSets[j].set);
    if(v>maxWithin){maxWithin=v;maxWithinPair=[confirmSets[i].id,confirmSets[j].id];}
    if(v>=0.90)nearWithin.push([confirmSets[i].id,confirmSets[j].id,Number(v.toFixed(4))]);
  }
  for(const a of confirmSets)for(const b of devSets){
    const v=jac(a.set,b.set);
    if(v>maxCross){maxCross=v;maxCrossPair=[a.id,b.id];}
    if(v>=0.85)crossLeak.push([a.id,b.id,Number(v.toFixed(4))]);
  }
  const perFamilyProfile={};
  for(const f of CONFIRMATORY_FAMILIES){
    perFamilyProfile[f]=count(pairs.filter(p=>p.family===f),p=>p.construction_provenance.ledger_profile);
  }
  const maxTemplate=Math.max(...Object.values(template));
  const out={
    schema_version:1,
    pairs:pairs.length,
    worlds:pairs.length*2,
    family_counts:family,
    domain_counts:domain,
    ledger_profile_counts:profile,
    per_family_ledger_profile_counts:perFamilyProfile,
    template_counts:template,
    max_template_concentration:Number((maxTemplate/pairs.length).toFixed(6)),
    unique_surface_hashes:Object.keys(surfaceHashes).length,
    exact_surface_duplicate_groups:exactDup,
    all_clean_current:pairs.every(p=>p.world_a.policy_input.evidence.every(e=>e.currentness==='current')&&p.world_b.policy_input.evidence.every(e=>e.currentness==='current')),
    all_profile_shapes_valid:pairs.every(profileShape),
    dual_validators_pass:validation.every(x=>x.a.valid&&x.b.valid),
    within_confirmatory_near_duplicate_threshold:0.90,
    within_confirmatory_near_duplicates:nearWithin,
    max_within_confirmatory_trigram_jaccard:Number(maxWithin.toFixed(6)),
    max_within_pair:maxWithinPair,
    cross_split_leakage_threshold:0.85,
    cross_split_leakage_pairs:crossLeak,
    max_dev_confirmatory_trigram_jaccard:Number(maxCross.toFixed(6)),
    max_cross_split_pair:maxCrossPair,
    gates:{
      pair_count_160:pairs.length===160,
      five_families_32_each:CONFIRMATORY_FAMILIES.every(f=>family[f]===32),
      sixteen_domains_10_each:CONFIRMATORY_DOMAINS.every(d=>domain[d.id]===10),
      four_profiles_40_each:LEDGER_PROFILES.every(p=>profile[p]===40),
      every_family_has_each_profile_8:CONFIRMATORY_FAMILIES.every(f=>LEDGER_PROFILES.every(p=>perFamilyProfile[f][p]===8)),
      exact_surface_unique:Object.keys(surfaceHashes).length===pairs.length,
      no_near_duplicates_at_090:nearWithin.length===0,
      no_dev_confirmatory_leakage_at_085:crossLeak.length===0,
      template_concentration_le_2pct:maxTemplate/pairs.length<=0.02,
      all_clean_current:pairs.every(p=>p.world_a.policy_input.evidence.every(e=>e.currentness==='current')&&p.world_b.policy_input.evidence.every(e=>e.currentness==='current')),
      all_profile_shapes_valid:pairs.every(profileShape),
      dual_validators_pass:validation.every(x=>x.a.valid&&x.b.valid)
    }
  };
  return out;
}

if(process.argv[1]&&process.argv[1].endsWith('audit-confirmatory-structure.mjs')){
  const r=auditConfirmatoryStructure();
  console.log(JSON.stringify(r,null,2));
  if(!Object.values(r.gates).every(Boolean))process.exit(1);
}
