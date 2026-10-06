const DIM=256;
const RRF_K=60;
const TOP_K=2;

const normalize=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
const tokens=s=>normalize(s).split(/\s+/).filter(Boolean);

function fnv1a(str){
  let h=0x811c9dc5;
  for(let i=0;i<str.length;i++){
    h^=str.charCodeAt(i);
    h=Math.imul(h,0x01000193)>>>0;
  }
  return h>>>0;
}

function charTrigrams(text){
  const s='  '+normalize(text)+'  ';
  const out=[];
  for(let i=0;i<=s.length-3;i++)out.push(s.slice(i,i+3));
  return out;
}

function hashedVector(text){
  const v=new Float64Array(DIM);
  for(const g of charTrigrams(text)){
    const h=fnv1a(g);
    const idx=h%DIM;
    const sign=(h&0x100)?1:-1;
    v[idx]+=sign;
  }
  let norm=0;for(const x of v)norm+=x*x;
  norm=Math.sqrt(norm);
  if(norm>0)for(let i=0;i<v.length;i++)v[i]/=norm;
  return v;
}

function cosine(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}

export function buildLexicalIdf(samples){
  const docs=samples.flatMap(s=>s.evidence.map(e=>new Set(tokens(e.fact))));
  const df=new Map();
  for(const d of docs)for(const t of d)df.set(t,(df.get(t)||0)+1);
  const N=docs.length;
  return Object.fromEntries([...df].map(([t,n])=>[t,Math.log((N+1)/(n+1))+1]));
}

export function lexicalRank(sample,idf){
  const q=new Set(tokens(sample.question));
  return sample.evidence.map(e=>{
    const d=new Set(tokens(e.fact));let score=0;
    for(const t of q)if(d.has(t))score+=idf[t]??1;
    return {evidence_id:e.evidence_id,score};
  }).sort((a,b)=>b.score-a.score||a.evidence_id.localeCompare(b.evidence_id));
}

export function denseRank(sample){
  const q=hashedVector(sample.question);
  return sample.evidence.map(e=>({
    evidence_id:e.evidence_id,
    score:cosine(q,hashedVector(e.fact))
  })).sort((a,b)=>b.score-a.score||a.evidence_id.localeCompare(b.evidence_id));
}

export function hybridRank(sample,idf){
  const lex=lexicalRank(sample,idf), dense=denseRank(sample);
  const score=new Map();
  for(const [i,r] of lex.entries())score.set(r.evidence_id,(score.get(r.evidence_id)||0)+1/(RRF_K+i+1));
  for(const [i,r] of dense.entries())score.set(r.evidence_id,(score.get(r.evidence_id)||0)+1/(RRF_K+i+1));
  return [...score].map(([evidence_id,s])=>({evidence_id,score:s}))
    .sort((a,b)=>b.score-a.score||a.evidence_id.localeCompare(b.evidence_id));
}

export function retrieve(condition,sample,idf){
  if(condition==='C0_FULL') return sample.evidence.map(e=>e.evidence_id);
  if(condition==='C1_HIDDEN') return sample.evidence.filter(e=>e.evidence_id!==sample.constructor_proposal.treatment_target_evidence_id).map(e=>e.evidence_id);
  if(condition==='C2_LEXICAL') return lexicalRank(sample,idf).slice(0,TOP_K).map(x=>x.evidence_id);
  if(condition==='C3_HASH_DENSE') return denseRank(sample).slice(0,TOP_K).map(x=>x.evidence_id);
  if(condition==='C4_HYBRID'||condition==='C5_COVERAGE_AWARE') return hybridRank(sample,idf).slice(0,TOP_K).map(x=>x.evidence_id);
  throw new Error('unknown condition '+condition);
}

export const RETRIEVAL_CONFIG={DIM,RRF_K,TOP_K};
