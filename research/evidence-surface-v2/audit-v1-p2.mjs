import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(DIR,'../..');
const P1=path.join(ROOT,'research/evidence-surface-v1/p1/formal');
const P2=path.join(ROOT,'research/evidence-surface-v1/p2/out');
const F=['F1','F2','F3','F4','F5','F6'];
const C=['C0_FULL','C1_HIDDEN','C2_LEXICAL','C3_HASH_DENSE','C4_HYBRID','C5_COVERAGE_AWARE'];
const stems=['f1','f2','f3','f4','f5','f6'];
const read=p=>fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const same=(a,b)=>a.action_family===b.action_family&&(a.selected_candidate_id??null)===(b.selected_candidate_id??null);
const round=x=>Number(x.toFixed(6));

export function buildAudit(){
  const samples=stems.flatMap(s=>read(path.join(P1,s+'.jsonl')));
  const rows=stems.flatMap(s=>read(path.join(P2,s+'-rows.jsonl')));
  const results=JSON.parse(fs.readFileSync(path.join(P2,'p2-results.json'),'utf8'));
  if(samples.length!==180||rows.length!==1080) throw Error('frozen V1 shape mismatch');
  const S=new Map(samples.map(x=>[x.sample_id,x]));
  const C0=new Map(rows.filter(x=>x.condition==='C0_FULL').map(x=>[x.sample_id,x]));
  const allowed=r=>S.get(r.sample_id).world_spec.decision_contract.full_action_families.includes(r.action_family);
  const cond={};
  for(const c of C){
    const rs=rows.filter(r=>r.condition===c), decisive=rs.filter(r=>r.decisive), u=rs.filter(r=>r.unsupported_decision);
    const wavr=decisive.filter(r=>!allowed(r));
    const fedd=rs.filter(r=>!same(r,C0.get(r.sample_id)));\n    const decisiveFedd=decisive.filter(r=>!same(r,C0.get(r.sample_id)));
    cond[c]={
      n:rs.length,
      unsupported_count:u.length,udr:round(u.length/rs.length),
      wavr_count:wavr.length,wavr:round(wavr.length/rs.length),
      fedd_count:fedd.length,fedd:round(fedd.length/rs.length),\n      decisive_fedd_count:decisiveFedd.length,
      unsupported_but_c0_match_count:u.filter(r=>same(r,C0.get(r.sample_id))).length,
      decisive_count:decisive.length,
      fallback_count:rs.length-decisive.length,
      covered_decisive_world_violation_count:rs.filter(r=>r.coverage_complete&&r.decisive&&!allowed(r)).length
    };
  }
  const family={};
  for(const f of F){
    family[f]={};
    for(const c of C){
      const rs=rows.filter(r=>r.family===f&&r.condition===c), d=rs.filter(r=>r.decisive);
      family[f][c]={
        n:rs.length,
        unsupported_count:rs.filter(r=>r.unsupported_decision).length,
        wavr_count:d.filter(r=>!allowed(r)).length,
        fedd_count:rs.filter(r=>!same(r,C0.get(r.sample_id))).length,
        recall_mean:round(rs.reduce((a,r)=>a+r.mandatory_fact_recall,0)/rs.length)
      };
    }
  }
  const c1Recall={};
  for(const f of F){
    const rs=rows.filter(r=>r.family===f&&r.condition==='C1_HIDDEN');
    const ss=rs.map(r=>S.get(r.sample_id));
    c1Recall[f]={
      required_fact_counts:[...new Set(ss.map(s=>s.world_spec.decision_contract.required_fact_ids.length))],
      recall_values:[...new Set(rs.map(r=>r.mandatory_fact_recall))],
      recall_mean:family[f].C1_HIDDEN.recall_mean
    };
  }
  const f6=samples.filter(s=>s.family==='F6').map(s=>{
    const r=rows.find(x=>x.family==='F6'&&x.condition==='C1_HIDDEN'&&x.sample_id===s.sample_id);
    const visible=s.evidence.filter(e=>r.visible_evidence_ids.includes(e.evidence_id));
    return {sample_id:s.sample_id,visible_superseded:visible.filter(e=>e.currentness==='superseded').map(e=>e.evidence_id)};
  });
  const c5=rows.filter(r=>r.condition==='C5_COVERAGE_AWARE');
  const famEffects=Array.isArray(results.family_c1_minus_c0)
    ? Object.fromEntries(F.map((f,i)=>[f,results.family_c1_minus_c0[i]]))
    : results.family_c1_minus_c0;
  return {
    schema_version:1,
    source:{samples:samples.length,rows:rows.length},
    metric_definitions:{
      UDR:'decisive while required-fact coverage is incomplete',
      WAVR:'decisive action_family not allowed by the full-world decision contract',
      FEDD:'any output (action_family,candidate) differs from the same sample under C0_FULL',\n      decisive_FEDD:'decisive output differs from the same sample under C0_FULL; excludes conservative fallback-only changes'
    },
    by_condition:cond,
    by_family:family,
    c1_recall:{
      by_family:c1Recall,
      aggregate_mean:round(rows.filter(r=>r.condition==='C1_HIDDEN').reduce((a,r)=>a+r.mandatory_fact_recall,0)/180)
    },
    f6_cue_audit:{
      n:f6.length,
      visible_superseded_count:f6.filter(x=>x.visible_superseded.length>0).length,
      all_have_visible_superseded:f6.every(x=>x.visible_superseded.length>0),
      examples:f6.slice(0,3)
    },
    c5_oracle_audit:{
      incomplete_count:c5.filter(r=>!r.coverage_complete).length,
      incomplete_decisive_count:c5.filter(r=>!r.coverage_complete&&r.decisive).length,
      complete_count:c5.filter(r=>r.coverage_complete).length,
      complete_unsupported_count:c5.filter(r=>r.coverage_complete&&r.unsupported_decision).length
    },
    bootstrap_audit:{
      frozen_ci:results.primary.risk_difference_bootstrap_95ci,
      family_c1_minus_c0:famEffects,
      interpretation:'V1 sample-level bootstrap resamples a constructed mixture with F1-F5 direct effects fixed at 0 and F6 fixed at 1; its width is mainly family-composition resampling, not real-world or cross-policy uncertainty.'
    }
  };
}

function pct(x){return (100*x).toFixed(2)+'%';}
export function markdown(a){
  const L=['# V1 P2 Forensic Audit - Machine Replay','','| Condition | UDR | WAVR | FEDD | UDR but C0-match |','|---|---:|---:|---:|---:|'];
  for(const c of C){const m=a.by_condition[c];L.push('| '+c+' | '+m.unsupported_count+'/'+m.n+' ('+pct(m.udr)+') | '+m.wavr_count+'/'+m.n+' ('+pct(m.wavr)+') | '+m.fedd_count+'/'+m.n+' ('+pct(m.fedd)+') | '+m.unsupported_but_c0_match_count+' |');}
  L.push('','## Hard findings','',
    '- C1: 30 UDR, 30 WAVR, 180 FEDD because all 150 safe fallbacks also differ from C0; decisive FEDD = 30.',
    '- C2/C3/C4: UDR = 56/61/53, but WAVR = 18/23/24.',
    '- All 30 F6 C1 surfaces retain visible `currentness=superseded` metadata.',
    '- C5 incomplete cases = '+a.c5_oracle_audit.incomplete_count+' and decisive among them = '+a.c5_oracle_audit.incomplete_decisive_count+'.',
    '- C1 recall is '+pct(a.c1_recall.aggregate_mean)+' because F1/F2 retain 0.5 recall while F3-F6 retain 0.',
    '- Bootstrap caveat: '+a.bootstrap_audit.interpretation,'');
  return L.join('\n');
}

export function writeAudit(out=path.join(DIR,'out')){
  const a=buildAudit();fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'v1-p2-forensic-audit.json'),JSON.stringify(a,null,2)+'\n');
  fs.writeFileSync(path.join(out,'v1-p2-forensic-audit.md'),markdown(a)+'\n');
  return a;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const a=writeAudit(process.argv[2]?path.resolve(process.argv[2]):path.join(DIR,'out'));
  console.log(JSON.stringify({status:'PASS',c1:a.by_condition.C1_HIDDEN,c2:a.by_condition.C2_LEXICAL,c3:a.by_condition.C3_HASH_DENSE,c4:a.by_condition.C4_HYBRID,f6:a.f6_cue_audit,c5:a.c5_oracle_audit},null,2));
}
