import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentnessFirstPolicy } from './policy-currentness-first.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(HERE,'../..');
const P1=path.join(ROOT,'research/evidence-surface-v1/p1/formal');
const P2=path.join(ROOT,'research/evidence-surface-v1/p2/out');
const STEMS=['f1','f2','f3','f4','f5','f6'];
const CONDITIONS=['C0_FULL','C1_HIDDEN','C2_LEXICAL','C3_HASH_DENSE','C4_HYBRID'];
const read=p=>fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const actionKey=x=>x.action_family+'::'+String(x.selected_candidate_id??'');

export function evaluateIndependentPolicyV1(){
  const samples=STEMS.flatMap(s=>read(path.join(P1,s+'.jsonl')));
  const rows=STEMS.flatMap(s=>read(path.join(P2,s+'-rows.jsonl')));
  const S=new Map(samples.map(s=>[s.sample_id,s]));
  const out=[];

  for(const r of rows.filter(r=>CONDITIONS.includes(r.condition))){
    const s=S.get(r.sample_id);
    const visible=s.evidence.filter(e=>r.visible_evidence_ids.includes(e.evidence_id));
    const p=currentnessFirstPolicy({evidence:visible,candidates:s.candidates});
    const allowed=new Set(
      s.world_spec.decision_contract.full_action_families.flatMap(f=>
        s.candidates.map(c=>actionKey({action_family:f,selected_candidate_id:c.candidate_id}))
      )
    );
    // Candidate correctness in V1 is operationalized against C0's selected candidate;
    // world contract only constrains the action family.
    const c0=rows.find(x=>x.sample_id===r.sample_id&&x.condition==='C0_FULL');
    const actionFamilyValid=!p.decisive || s.world_spec.decision_contract.full_action_families.includes(p.action_family);
    const sameCandidate=!p.decisive || p.selected_candidate_id===c0.selected_candidate_id;
    out.push({
      sample_id:r.sample_id,
      family:r.family,
      condition:r.condition,
      action:p,
      decisive:p.decisive,
      action_family_valid:actionFamilyValid,
      same_candidate_as_v1_c0:sameCandidate,
      strict_decisive_match_v1_c0:p.decisive && p.action_family===c0.action_family && p.selected_candidate_id===c0.selected_candidate_id,
      world_action_violation:p.decisive && !actionFamilyValid,
      candidate_divergence:p.decisive && !sameCandidate,
      fallback:!p.decisive
    });
  }

  const byCondition={};
  for(const c of CONDITIONS){
    const rs=out.filter(r=>r.condition===c);
    byCondition[c]={
      n:rs.length,
      decisive_count:rs.filter(r=>r.decisive).length,
      fallback_count:rs.filter(r=>r.fallback).length,
      wavr_count:rs.filter(r=>r.world_action_violation).length,
      candidate_divergence_count:rs.filter(r=>r.candidate_divergence).length,
      strict_c0_match_count:rs.filter(r=>r.strict_decisive_match_v1_c0).length
    };
  }
  const byFamily={};
  for(const f of ['F1','F2','F3','F4','F5','F6']){
    byFamily[f]={};
    for(const c of CONDITIONS){
      const rs=out.filter(r=>r.family===f&&r.condition===c);
      byFamily[f][c]={
        decisive_count:rs.filter(r=>r.decisive).length,
        fallback_count:rs.filter(r=>r.fallback).length,
        wavr_count:rs.filter(r=>r.world_action_violation).length,
        candidate_divergence_count:rs.filter(r=>r.candidate_divergence).length
      };
    }
  }
  return {schema_version:1,policy:'currentness-first-v0',by_condition:byCondition,by_family:byFamily,rows:out};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const r=evaluateIndependentPolicyV1();
  if(process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]),JSON.stringify(r,null,2)+'\n');
  console.log(JSON.stringify({policy:r.policy,by_condition:r.by_condition,by_family:r.by_family},null,2));
}
