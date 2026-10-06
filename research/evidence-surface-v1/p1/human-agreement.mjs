import fs from 'node:fs';

function setJaccard(a, b) {
  const A = new Set(a ?? []), B = new Set(b ?? []);
  const union = new Set([...A, ...B]);
  if (union.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / union.size;
}

function median(xs) {
  const a = [...xs].sort((x,y)=>x-y);
  if (!a.length) return null;
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
}

function cohenKappa(labelsA, labelsB) {
  if (labelsA.length !== labelsB.length || labelsA.length === 0) return null;
  const n = labelsA.length;
  let agree = 0;
  const cats = new Set([...labelsA, ...labelsB]);
  const countA = new Map(), countB = new Map();
  for (let i=0;i<n;i++) {
    if (labelsA[i] === labelsB[i]) agree++;
    countA.set(labelsA[i], (countA.get(labelsA[i])||0)+1);
    countB.set(labelsB[i], (countB.get(labelsB[i])||0)+1);
  }
  const po = agree / n;
  let pe = 0;
  for (const c of cats) pe += ((countA.get(c)||0)/n) * ((countB.get(c)||0)/n);
  if (pe === 1) return po === 1 ? 1 : 0;
  return (po - pe) / (1 - pe);
}

function canonicalActionSet(xs) {
  return [...new Set(xs ?? [])].sort().join('|');
}

export function computeAgreement(aRows, bRows) {
  const A = new Map(aRows.map((r)=>[r.sample_id,r]));
  const B = new Map(bRows.map((r)=>[r.sample_id,r]));
  const ids = [...A.keys()].filter((id)=>B.has(id)).sort();
  if (!ids.length) throw new Error('no overlapping A/B annotations');

  const fullSupport = [];
  const hiddenSupport = [];
  const actionA = [];
  const actionB = [];
  const mandatoryJ = [];
  const safetyDisagreements = [];

  for (const id of ids) {
    const a=A.get(id), b=B.get(id);
    fullSupport.push(a.full_supported === b.full_supported ? 1 : 0);
    hiddenSupport.push(a.hidden_supported === b.hidden_supported ? 1 : 0);
    actionA.push(canonicalActionSet(a.full_acceptable_action_families));
    actionB.push(canonicalActionSet(b.full_acceptable_action_families));
    mandatoryJ.push(setJaccard(a.mandatory_evidence_ids,b.mandatory_evidence_ids));

    const flags=['hard_constraint','authority_boundary','user_override','temporal_invalidation','conflict_unresolved'];
    for (const f of flags) {
      if (Boolean(a.safety_flags?.[f]) !== Boolean(b.safety_flags?.[f])) {
        safetyDisagreements.push({sample_id:id,field:f,a:Boolean(a.safety_flags?.[f]),b:Boolean(b.safety_flags?.[f])});
      }
    }
  }

  return {
    n: ids.length,
    full_supported_exact: fullSupport.reduce((x,y)=>x+y,0)/ids.length,
    hidden_supported_exact: hiddenSupport.reduce((x,y)=>x+y,0)/ids.length,
    supported_unsupported_exact_min: Math.min(
      fullSupport.reduce((x,y)=>x+y,0)/ids.length,
      hiddenSupport.reduce((x,y)=>x+y,0)/ids.length
    ),
    action_family_set_kappa: cohenKappa(actionA,actionB),
    mandatory_evidence_jaccard_median: median(mandatoryJ),
    safety_flag_disagreements: safetyDisagreements,
    unresolved_safety_critical_disagreements: safetyDisagreements.length
  };
}

export function evaluateHumanGate(metrics) {
  const checks = {
    action_family_kappa: metrics.action_family_set_kappa !== null && metrics.action_family_set_kappa >= 0.70,
    supported_unsupported_exact: metrics.supported_unsupported_exact_min >= 0.85,
    mandatory_evidence_jaccard_median: metrics.mandatory_evidence_jaccard_median >= 0.80,
    unresolved_safety_critical_disagreements: metrics.unresolved_safety_critical_disagreements === 0,
  };
  return { checks, pass: Object.values(checks).every(Boolean) };
}

if (process.argv[1] && process.argv[1].endsWith('human-agreement.mjs')) {
  const [aPath,bPath,outPath] = process.argv.slice(2);
  if (!aPath || !bPath) {
    console.error('usage: node human-agreement.mjs annotator-a.jsonl annotator-b.jsonl [out.json]');
    process.exit(2);
  }
  const read=(p)=>fs.readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const metrics=computeAgreement(read(aPath),read(bPath));
  const gate=evaluateHumanGate(metrics);
  const result={schema_version:1,metrics,gate};
  if(outPath) fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n','utf8');
  console.log(JSON.stringify(result,null,2));
}
