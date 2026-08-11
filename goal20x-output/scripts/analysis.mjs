// Goal20X analysis: run-stratified outlier tests + neighbor structural comparison.
import fs from 'node:fs';
const OUT = 'D:\\ai_code\\Omni-context\\goal20x-output';
const fore = JSON.parse(fs.readFileSync(OUT + '/tuple-711-cross-run-forensics.json', 'utf8'));
const census = fs.readFileSync(OUT + '/empty-content-census.jsonl', 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

// ---- run-stratified position test ----
const runs = [...new Set(census.map((e) => e.run))];
const eventsByRun = {};
for (const e of census) {
  eventsByRun[e.run] = eventsByRun[e.run] || [];
  eventsByRun[e.run].push(e);
}
const expectedHitsPerRun = {};
for (const r of runs) {
  const m = eventsByRun[r].length;
  expectedHitsPerRun[r] = 1 - Math.pow(1 - 1 / 720, m);
}
const expectedTotalHits = Object.values(expectedHitsPerRun).reduce((a, b) => a + b, 0);
const hitsPerRun711 = {};
for (const r of runs) hitsPerRun711[r] = eventsByRun[r].filter((e) => e.tuple === 711).length;
const runsHitting711 = Object.values(hitsPerRun711).filter((n) => n > 0).length;
function poissonTail(lambda, k) {
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += Math.exp(-lambda) * Math.pow(lambda, i) / factorial(i);
  return 1 - sum + Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
function factorial(n) { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }
const poissonRuns711 = poissonTail(expectedTotalHits, runsHitting711);

// ---- slot (TT-idx) stratified by run ----
const slotByRun = {};
for (const e of census) {
  const k = `${e.TT}-${e.slot}`;
  slotByRun[k] = slotByRun[k] || { total: 0, byRun: {} };
  slotByRun[k].total++;
  slotByRun[k].byRun[e.run] = (slotByRun[k].byRun[e.run] || 0) + 1;
}
const slotRank = Object.entries(slotByRun).sort((a, b) => b[1].total - a[1].total);
const slotExpectedPerRun = {};
for (const r of runs) {
  const m = eventsByRun[r].length;
  slotExpectedPerRun[r] = 1 - Math.pow(1 - 1 / 120, m);
}
const slotExpectedTotal = Object.values(slotExpectedPerRun).reduce((a, b) => a + b, 0);
const slotRunsForTT15_006 = slotByRun['TT15-006']?.byRun ?? {};
const tt15_006_runsHitting = Object.values(slotRunsForTT15_006).filter((n) => n > 0).length;
const poissonSlotTT15_006 = poissonTail(slotExpectedTotal, tt15_006_runsHitting);

// ---- neighbor structural comparison ----
const neighbors = fore.neighbors;
const stats = (vals) => {
  const vv = vals.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!vv.length) return { n: 0, mean: null, sd: null, min: null, max: null };
  const mean = vv.reduce((a, b) => a + b, 0) / vv.length;
  const sd = Math.sqrt(vv.reduce((a, b) => a + (b - mean) ** 2, 0) / vv.length);
  return { n: vv.length, mean: +mean.toFixed(2), sd: +sd.toFixed(2), min: Math.min(...vv), max: Math.max(...vv) };
};
const zscore = (x, s) => (s && s.sd > 0 && x !== null && x !== undefined ? +((x - s.mean) / s.sd).toFixed(2) : null);
const neighborAnalysis = {};
for (const run of Object.keys(neighbors)) {
  const block = neighbors[run];
  const a3 = block.filter((b) => b.arm === 'A3');
  const t711 = a3.find((b) => b.tuple_index === 711);
  const sameSample = block.filter((b) => b.tuple_index >= 708 && b.tuple_index <= 713); // tt15-006 A0..A5
  const tt15a3 = a3.filter((b) => b.tuple_index >= 672 && b.tuple_index <= 719); // A3 x 8 TT15 samples
  const tt15 = block.filter((b) => b.tuple_index >= 672 && b.tuple_index <= 719); // full TT15 block all arms
  const refs = {
    same_sample_tt15_006_all_arms: {
      n: sameSample.length,
      input_tokens: stats(sameSample.map((b) => b.input_tokens)),
      prompt_bytes_total: stats(sameSample.map((b) => b.prompt_bytes?.total ?? null)),
      empty_rate: sameSample.filter((b) => b.empty_attempts > 0).length / (sameSample.length || 1),
    },
    tt15_a3_arm: {
      n: tt15a3.length,
      input_tokens: stats(tt15a3.map((b) => b.input_tokens)),
      prompt_bytes_total: stats(tt15a3.map((b) => b.prompt_bytes?.total ?? null)),
      evidence_qualified: stats(tt15a3.map((b) => b.structural?.evidence_qualified_count ?? null)),
      evidence_expired: stats(tt15a3.map((b) => b.structural?.evidence_expired_count ?? null)),
      candidates: stats(tt15a3.map((b) => b.structural?.candidates_count ?? null)),
      timeline_events: stats(tt15a3.map((b) => b.structural?.timeline_events_count ?? null)),
      empty_rate: tt15a3.filter((b) => b.empty_attempts > 0).length / (tt15a3.length || 1),
    },
    full_tt15_block_all_arms: {
      n: tt15.length,
      input_tokens: stats(tt15.map((b) => b.input_tokens)),
      prompt_bytes_total: stats(tt15.map((b) => b.prompt_bytes?.total ?? null)),
      empty_rate: tt15.filter((b) => b.empty_attempts > 0).length / (tt15.length || 1),
    },
  };
  neighborAnalysis[run] = {
    tuple_711_A3: t711 ? {
      input_tokens: t711.input_tokens,
      prompt_bytes_total: t711.prompt_bytes?.total ?? null,
      evidence_qualified: t711.structural?.evidence_qualified_count ?? null,
      evidence_expired: t711.structural?.evidence_expired_count ?? null,
      candidates: t711.structural?.candidates_count ?? null,
      timeline_events: t711.structural?.timeline_events_count ?? null,
      authority: t711.structural?.authority_level ?? null,
      hard_constraints: t711.structural?.hard_constraints_count ?? null,
      empty_attempts: t711.empty_attempts,
      status: t711.status,
    } : null,
    z_vs_same_sample_arms: t711 ? {
      input_tokens: zscore(t711.input_tokens, refs.same_sample_tt15_006_all_arms.input_tokens),
      prompt_bytes_total: zscore(t711.prompt_bytes?.total ?? null, refs.same_sample_tt15_006_all_arms.prompt_bytes_total),
    } : null,
    z_vs_tt15_a3: t711 ? {
      input_tokens: zscore(t711.input_tokens, refs.tt15_a3_arm.input_tokens),
      prompt_bytes_total: zscore(t711.prompt_bytes?.total ?? null, refs.tt15_a3_arm.prompt_bytes_total),
      evidence_qualified: zscore(t711.structural?.evidence_qualified_count ?? null, refs.tt15_a3_arm.evidence_qualified),
      timeline_events: zscore(t711.structural?.timeline_events_count ?? null, refs.tt15_a3_arm.timeline_events),
    } : null,
    refs,
  };
}

// ---- temporal analysis ----
const times = census.map((e) => ({ run: e.run, at: e.timestamp ? Date.parse(e.timestamp) : null })).filter((x) => x.at);
times.sort((a, b) => a.at - b.at);
const gaps = [];
for (let i = 1; i < times.length; i++) gaps.push(times[i].at - times[i - 1].at);
const sortedGaps = [...gaps].sort((a, b) => a - b);
const gapStats = gaps.length ? {
  n: gaps.length,
  min_s: Math.min(...gaps) / 1000,
  median_s: sortedGaps[Math.floor(sortedGaps.length / 2)] / 1000,
  p90_s: sortedGaps[Math.floor(sortedGaps.length * 0.9)] / 1000,
  max_min: Math.max(...gaps) / 60000,
} : null;
const burstMap = new Map();
for (const e of census) {
  const k = `${e.run}|${e.tuple}|${e.arm}`;
  if (!burstMap.has(k)) burstMap.set(k, { run: e.run, tuple: e.tuple, arm: e.arm, attempts: [], timestamps: [] });
  burstMap.get(k).attempts.push(e.attempt);
  burstMap.get(k).timestamps.push(e.timestamp);
}
const uniqueBursts = [...burstMap.values()].filter((b) => b.attempts.length > 1);

const result = {
  schema_version: 1,
  purpose: 'GOAL20X_STRATIFIED_OUTLIER_AND_NEIGHBOR_ANALYSIS',
  created_at: new Date().toISOString(),
  provider_calls_made: 0,
  run_stratified_position_711: {
    events_by_run: hitsPerRun711,
    runs_hitting_711: runsHitting711,
    expected_hits_per_run: expectedHitsPerRun,
    expected_total_hits_uniform: +expectedTotalHits.toFixed(4),
    poisson_tail_runs_hitting_711: poissonRuns711,
    interpretation: 'under uniform position null, expected <0.5 runs to ever hit position 711; observed 3 runs -> extremely unlikely by chance',
  },
  slot_analysis: {
    rank_by_total: slotRank.slice(0, 12),
    tt15_006: {
      total: slotByRun['TT15-006']?.total ?? 0,
      byRun: slotRunsForTT15_006,
      runs_hitting: tt15_006_runsHitting,
      expected_total_hits_uniform: +slotExpectedTotal.toFixed(4),
      poisson_tail: poissonSlotTT15_006,
      interpretation: 'under uniform slot null (120 slots), expected <0.6 runs to ever hit TT15-006; observed multiple runs -> extremely unlikely by chance',
    },
  },
  neighbor_comparison: neighborAnalysis,
  temporal: { gaps: gapStats, multi_empty_bursts: uniqueBursts },
};
fs.writeFileSync(OUT + '/analysis-stratified.json', JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log('runs hitting 711:', runsHitting711, 'expected:', expectedTotalHits.toFixed(4), 'poisson tail:', poissonRuns711.toExponential(3));
console.log('TT15-006 total:', slotByRun['TT15-006']?.total, 'runs:', tt15_006_runsHitting, 'expected:', slotExpectedTotal.toFixed(4), 'tail:', poissonSlotTT15_006.toExponential(3));
console.log('bursts:', uniqueBursts.length);
console.log(JSON.stringify(neighborAnalysis.v3r1, null, 1));