const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = 'D:/ai_code/Omni-context';
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
const FIX = {
  v3: arg('--v3', `${ROOT}/goal20r-output/validation-v3-fixture.jsonl`),
  v2: `${ROOT}/goal18he-output/validation-v2-fixture.jsonl`,
  dev: `${ROOT}/goal20-cross-machine-handoff/execution-snapshot/goal14-output/development-fixtures.jsonl`,
  reg: `${ROOT}/goal20-cross-machine-handoff/execution-snapshot/goal14-output/regression-fixtures.jsonl`
};
const load = (f) => fs.readFileSync(f, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
const data = { v3: load(FIX.v3), v2: load(FIX.v2), dev: load(FIX.dev), reg: load(FIX.reg) };

function norm(s) { return s.replace(/[\s\u3000]+/g, ' ').trim(); }
function shingles(s) { const o = new Set(); for (let i = 0; i + 8 <= s.length; i++) o.add(s.slice(i, i + 8)); return o; }
function jaccard(a, b) { if (!a.size || !b.size) return 0; let inter = 0; const [s, bg] = a.size < b.size ? [a, b] : [b, a]; for (const x of s) if (bg.has(x)) inter++; return inter / (a.size + b.size - inter); }
function sampleText(s) {
  const parts = [s.title, s.goal.text, s.decision_question, s.scenario.prompt];
  for (const e of s.memory_timeline) parts.push(e.content);
  for (const c of s.candidates) parts.push(c.label, c.description);
  for (const h of s.hard_constraints) parts.push(h.text);
  for (const p of s.soft_preferences) parts.push(p.text);
  for (const ev of [...s.evidence.qualified, ...s.evidence.expired, ...s.evidence.conflicting]) parts.push(ev.fact);
  if (s.historical_decision) parts.push(s.historical_decision.question, s.historical_decision.conclusion);
  if (s.execution_outcome) parts.push(s.execution_outcome.actual_outcome);
  return norm(parts.join(' '));
}

const texts = {};
for (const k of Object.keys(data)) {
  texts[k] = data[k].map((s) => ({ id: s.sample_id, text: sampleText(s), scenario: JSON.stringify(s.scenario), title: s.title }));
  for (const t of texts[k]) t.shingles = shingles(t.text);
}

function pairStats(aList, bList, label) {
  let max = 0, sum = 0, n = 0; const flagged = [], near = []; let worst = null;
  for (const a of aList) for (const b of bList) {
    const sim = jaccard(a.shingles, b.shingles);
    n++; sum += sim;
    if (sim > max) { max = sim; worst = { a: a.id, b: b.id, sim: +sim.toFixed(4) }; }
    if (sim >= 0.5) flagged.push({ a: a.id, b: b.id, sim: +sim.toFixed(4), same_slot: a.id === b.id });
    if (sim >= 0.75) near.push({ a: a.id, b: b.id, sim: +sim.toFixed(4), same_slot: a.id === b.id });
  }
  flagged.sort((x, y) => y.sim - x.sim);
  near.sort((x, y) => y.sim - x.sim);
  return { label, pairs: n, max: +max.toFixed(4), mean: +(sum / n).toFixed(6), flagged_count: flagged.length, flagged_all: flagged, near_duplicate_count: near.length, near_duplicate_all: near, worst };
}

function exactChecks(aList, bList, label) {
  const aIds = new Set(aList.map((t) => t.id));
  const bIds = new Set(bList.map((t) => t.id));
  const idOverlap = [...aIds].filter((x) => bIds.has(x));
  const aScen = new Map(aList.map((t) => [t.id, t.scenario]));
  const bScenMap = new Map(bList.map((t) => [t.id, t.scenario]));
  const scenOverlap = [...aScen.entries()].filter(([id, sc]) => { for (const [bid, bsc] of bScenMap) if (id !== bid && bsc === sc) return true; return false; }).map(([id]) => id);
  const aTitles = new Set(aList.map((t) => t.title));
  const bTitles = new Set(bList.map((t) => t.title));
  return { label, exact_sample_id_overlap_count: idOverlap.length, exact_sample_id_overlap: idOverlap.slice(0, 200), exact_scenario_overlap_count: scenOverlap.length, exact_title_overlap: [...aTitles].filter((x) => bTitles.has(x)) };
}

function internal(aList, label) {
  const ids = aList.map((t) => t.id);
  const dupIds = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
  const scen = aList.map((t) => t.scenario);
  const dupScen = [...new Set(scen.filter((x, i) => scen.indexOf(x) !== i))];
  const titles = aList.map((t) => t.title);
  const dupTitles = [...new Set(titles.filter((x, i) => titles.indexOf(x) !== i))];
  let max = 0; let worst = null;
  for (let i = 0; i < aList.length; i++) for (let j = i + 1; j < aList.length; j++) {
    const sim = jaccard(aList[i].shingles, aList[j].shingles);
    if (sim > max) { max = sim; worst = { a: aList[i].id, b: aList[j].id, sim: +sim.toFixed(4) }; }
  }
  return { label, samples: aList.length, duplicate_ids: dupIds, duplicate_scenario_count: dupScen.length, duplicate_titles: dupTitles, internal_max_8gram_jaccard: +max.toFixed(4), internal_worst: worst };
}

const out = {
  artifact: 'goal20r-output/validation-v3-overlap-leakage-audit.json',
  generated_at: new Date().toISOString(),
  method: 'Normalized 8-gram Jaccard on sampleText (title, goal, decision_question, scenario.prompt, memory events, candidates, constraints, prefs, evidence facts, historical decision, execution outcome); exact sample_id / scenario-JSON / title overlap. Same methodology as goal18-output/leakage-analysis.md and integrity test T12. Entity prefix check imports generator pools.mjs (VAL_PREFIXES / HB_PREFIXES).',
  sources: {
    v3_fixture: 'goal20r-output/validation-v3-fixture.jsonl (120)',
    v2_fixture: 'goal18he-output/validation-v2-fixture.jsonl (120)',
    dev_fixture: 'goal14-output/development-fixtures.jsonl (20, v1)',
    reg_fixture: 'goal14-output/regression-fixtures.jsonl (15, v1)'
  },
  thresholds: { flag: 0.5, near_duplicate_diagnostic: 0.75, design_target_max: 0.4 },
  internal: { v3: internal(texts.v3, 'v3') },
  exact: {
    v3_vs_v2: exactChecks(texts.v3, texts.v2, 'v3_vs_v2'),
    v3_vs_dev: exactChecks(texts.v3, texts.dev, 'v3_vs_dev'),
    v3_vs_reg: exactChecks(texts.v3, texts.reg, 'v3_vs_reg')
  },
  similarity: {
    v3_vs_v2: pairStats(texts.v3, texts.v2, 'v3_vs_v2'),
    v3_vs_dev: pairStats(texts.v3, texts.dev, 'v3_vs_dev'),
    v3_vs_reg: pairStats(texts.v3, texts.reg, 'v3_vs_reg')
  }
};

// Entity prefix check using the real pools module.
(async () => {
  const pools = await import(pathToFileURL(`${ROOT}/goal18-output/scripts/generator/pools.mjs`).href);
  const valPrefixes = pools.VAL_PREFIXES;
  const hbPrefixes = pools.HB_PREFIXES;
  const allText = texts.v3.map((t) => t.text).join('');
  const valHits = valPrefixes.filter((p) => allText.includes(p));
  const hbHits = hbPrefixes.filter((p) => allText.includes(p));
  out.entity_prefixes = {
    note: 'V3 uses tag=val, so it draws entity names from the same 24 VAL_PREFIXES as V2 (disjoint from holdback by construction). Prefix reuse across V2/V3 is by design and is not leakage.',
    val_prefixes_in_pool: valPrefixes.length,
    holdback_prefixes_in_pool: hbPrefixes.length,
    val_prefix_hits_in_v3: valHits,
    holdback_prefix_hits_in_v3: hbHits
  };

  const sims = [out.similarity.v3_vs_v2, out.similarity.v3_vs_dev, out.similarity.v3_vs_reg];
  const maxSim = Math.max(...sims.map((s) => s.max));
  const idOverlapTotal = [out.exact.v3_vs_v2, out.exact.v3_vs_dev, out.exact.v3_vs_reg].reduce((a, e) => a + e.exact_sample_id_overlap_count, 0);
  const scenOverlapTotal = [out.exact.v3_vs_v2, out.exact.v3_vs_dev, out.exact.v3_vs_reg].reduce((a, e) => a + e.exact_scenario_overlap_count, 0);
  const nearTotal = sims.reduce((a, s) => a + s.near_duplicate_count, 0);
  const flagTotal = sims.reduce((a, s) => a + s.flagged_count, 0);

  out.verdict = {
    duplicate_ids_in_v3: out.internal.v3.duplicate_ids.length,
    exact_sample_id_overlap_total: idOverlapTotal,
    exact_scenario_overlap_total: scenOverlapTotal,
    max_8gram_jaccard: maxSim,
    flagged_pairs_ge_0_5: flagTotal,
    near_duplicate_diagnostic_pairs_ge_0_75: nearTotal,
    holdback_prefix_leak: hbHits.length > 0,
    section19_checks: {
      zero_exact_overlap_with_v2: { status: idOverlapTotal === 0 && scenOverlapTotal === 0 ? 'PASS' : 'FAIL', detail: `sample_id overlap=${out.exact.v3_vs_v2.exact_sample_id_overlap_count}, scenario overlap=${out.exact.v3_vs_v2.exact_scenario_overlap_count}` },
      zero_exact_overlap_with_development: { status: out.exact.v3_vs_dev.exact_sample_id_overlap_count === 0 && out.exact.v3_vs_dev.exact_scenario_overlap_count === 0 ? 'PASS' : 'FAIL' },
      zero_exact_overlap_with_regression: { status: out.exact.v3_vs_reg.exact_sample_id_overlap_count === 0 && out.exact.v3_vs_reg.exact_scenario_overlap_count === 0 ? 'PASS' : 'FAIL' },
      zero_duplicate_sample_ids: { status: out.internal.v3.duplicate_ids.length === 0 ? 'PASS' : 'FAIL' },
      zero_scenario_identity_overlap: { status: scenOverlapTotal === 0 ? 'PASS' : 'FAIL' },
      near_duplicate_diagnostic: { status: nearTotal === 0 ? 'PASS' : 'FAIL', detail: `${nearTotal} pairs >= 0.75, max ${maxSim}` }
    },
    status: Object.values({ zero_exact_overlap_with_v2: idOverlapTotal === 0 && scenOverlapTotal === 0, zero_exact_overlap_with_development: out.exact.v3_vs_dev.exact_sample_id_overlap_count === 0 && out.exact.v3_vs_dev.exact_scenario_overlap_count === 0, zero_exact_overlap_with_regression: out.exact.v3_vs_reg.exact_sample_id_overlap_count === 0 && out.exact.v3_vs_reg.exact_scenario_overlap_count === 0, zero_duplicate_sample_ids: out.internal.v3.duplicate_ids.length === 0, zero_scenario_identity_overlap: scenOverlapTotal === 0, near_duplicate_diagnostic: nearTotal === 0 }).every(Boolean) && !hbHits.length ? 'PASS' : 'FAIL'
  };
  fs.writeFileSync(arg('--out', 'D:/ai_code/Omni-context/goal20r-output/validation-v3-overlap-leakage-audit.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ internal: out.internal.v3, exact_summary: { v2: { id: out.exact.v3_vs_v2.exact_sample_id_overlap_count, scen: out.exact.v3_vs_v2.exact_scenario_overlap_count }, dev: { id: out.exact.v3_vs_dev.exact_sample_id_overlap_count, scen: out.exact.v3_vs_dev.exact_scenario_overlap_count }, reg: { id: out.exact.v3_vs_reg.exact_sample_id_overlap_count, scen: out.exact.v3_vs_reg.exact_scenario_overlap_count } }, similarity_summary: sims.map((s) => ({ label: s.label, pairs: s.pairs, max: s.max, mean: s.mean, flagged: s.flagged_count, near: s.near_duplicate_count })), entity_prefixes: out.entity_prefixes, verdict: out.verdict }, null, 2));
})();
