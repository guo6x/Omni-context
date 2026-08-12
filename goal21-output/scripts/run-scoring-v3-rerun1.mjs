// Goal20 formal scoring pipeline - Stage S (scorer v1.1, frozen) - Validation V3-R1.
// Reads: frozen raw-results.jsonl (V3 run), validation-v3-r1 fixture + gold. Never writes run dir.
// Zero provider calls. Deterministic.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreSample, aggregate, evaluateGates, SCORER_VERSION, UNIFIED_GATES } from '../../goal20-cross-machine-handoff/execution-snapshot/goal16a-output/scorer-v1.1/scorer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const RUN_DIR = path.join(ROOT, 'goal20-formal-execution-governance-v3/runs/goal20-formal-validation-v1/2026-08-11T17-45-38-164Z-f7f19012');
const RAW_FILE = path.join(RUN_DIR, 'raw-results.jsonl');
const FIXTURE_FILE = path.join(ROOT, 'goal20r-output/validation-v3-r1-fixture.jsonl');
const GOLD_FILE = path.join(ROOT, 'goal20r-output/validation-v3-r1-gold.jsonl');
const SCORER_FILE = path.join(ROOT, 'goal20-cross-machine-handoff/execution-snapshot/goal16a-output/scorer-v1.1/scorer.mjs');
const OUT_DIR = path.join(ROOT, 'goal21-output');
const OUT_FILE = path.join(OUT_DIR, 'goal20-scoring-results-v3-rerun1.json');

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sha256buf = (b) => crypto.createHash('sha256').update(b).digest('hex');
const readJsonl = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const t0 = Date.now();

// ---------- identities (pre-scoring re-verification) ----------
const rawShaBefore = sha256(RAW_FILE);
const fixtureSha = sha256(FIXTURE_FILE);
const goldSha = sha256(GOLD_FILE);
const scorerSha = sha256(SCORER_FILE);
// Frozen identity = git blob hash with autocrlf LF normalization (matches sealed-identity-bundle file_blobs).
const gitBlobHash = (file) => {
  const b = fs.readFileSync(file).toString('utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha1').update(`blob ${Buffer.byteLength(b, 'utf8')}\0`).update(b, 'utf8').digest('hex');
};
const scorerBlobSha1 = gitBlobHash(SCORER_FILE);
const scorerTestBlobSha1 = gitBlobHash(path.join(ROOT, 'goal20-cross-machine-handoff/execution-snapshot/goal16a-output/scorer-v1.1/conformance-tests/scorer-v1.1.test.mjs'));
const goldContractBlobSha1 = gitBlobHash(path.join(ROOT, 'goal20-cross-machine-handoff/execution-snapshot/goal14-output/benchmark-gold-contract.schema.json'));
const metricDefsBlobSha1 = gitBlobHash(path.join(ROOT, 'goal20-cross-machine-handoff/execution-snapshot/goal14-output/metric-definitions.md'));

// Expected raw identity is bound by the GOAL20_RAW_OUTPUT_FREEZE_V3_R1_RERUN_1 record (created only after run completion + integrity audit).
const RAW_FREEZE_FILE = path.join(ROOT, 'goal20-formal-execution-governance-v3/governance/GOAL20_RAW_OUTPUT_FREEZE_V3_R1_RERUN_1');
if (!fs.existsSync(RAW_FREEZE_FILE)) {
  console.error('RAW FREEZE FILE MISSING - aborting scoring (freeze must be signed before scoring)');
  process.exit(2);
}
const rawFreeze = JSON.parse(fs.readFileSync(RAW_FREEZE_FILE, 'utf8'));
const expectedRawFromFreeze = rawFreeze.hashes?.raw_resources_jsonl_sha256 ?? rawFreeze.binds?.hashes?.raw_resources_jsonl_sha256;
if (!expectedRawFromFreeze) {
  console.error('RAW FREEZE FILE HAS NO binds.hashes.raw_resources_jsonl_sha256 - aborting scoring');
  process.exit(2);
}

const expected = {
  raw: expectedRawFromFreeze,
  fixture: '78e61a1522640aab7e8d0872faefc68553e41dc3abd73ba7073248124550f85e',
  gold: 'e28d37f7075251b18479380132453b53f3141ce9a4289b32d427ded50bccf0c0',
  scorerBlobSha1: '47a4217f14992e02899dddea44416571564c56de',
  scorerTestBlobSha1: '6cce82b23a90d07fd241c8a083f991f89f782297',
  goldContractBlobSha1: 'a17503af3525fa38ddc7b5949076d243f99b4b05',
  metricDefsBlobSha1: 'acc89ef6daec47f8470eff2df49bf15476fed6a8',
};
const identityChecks = {
  raw_sha256: { actual: rawShaBefore, expected: expected.raw, pass: rawShaBefore === expected.raw },
  fixture_sha256: { actual: fixtureSha, expected: expected.fixture, pass: fixtureSha === expected.fixture },
  gold_sha256: { actual: goldSha, expected: expected.gold, pass: goldSha === expected.gold },
  scorer_blob_sha1: { actual: scorerBlobSha1, expected: expected.scorerBlobSha1, pass: scorerBlobSha1 === expected.scorerBlobSha1 },
  scorer_test_blob_sha1: { actual: scorerTestBlobSha1, expected: expected.scorerTestBlobSha1, pass: scorerTestBlobSha1 === expected.scorerTestBlobSha1 },
  gold_contract_blob_sha1: { actual: goldContractBlobSha1, expected: expected.goldContractBlobSha1, pass: goldContractBlobSha1 === expected.goldContractBlobSha1 },
  metric_definitions_blob_sha1: { actual: metricDefsBlobSha1, expected: expected.metricDefsBlobSha1, pass: metricDefsBlobSha1 === expected.metricDefsBlobSha1 },
};
const identityPass = Object.values(identityChecks).every((c) => c.pass);
if (!identityPass) {
  console.error('IDENTITY MISMATCH - aborting scoring');
  console.error(JSON.stringify(identityChecks, null, 2));
  process.exit(2);
}

// ---------- load ----------
const raw = readJsonl(RAW_FILE);
const fixture = readJsonl(FIXTURE_FILE);
const gold = readJsonl(GOLD_FILE);
const fixtureMap = new Map(fixture.map((f) => [f.sample_id, f]));
const goldMap = new Map(gold.map((g) => [g.sample_id, g]));

// ---------- integrity pre-checks ----------
const dupKeys = new Map();
for (const r of raw) {
  const k = `${r.tuple.sample_id}|${r.arm}`;
  dupKeys.set(k, (dupKeys.get(k) || 0) + 1);
}
const duplicates = [...dupKeys.entries()].filter(([, v]) => v > 1);
const rawSampleIds = new Set(raw.map((r) => r.tuple.sample_id));
const unexpectedIds = [...rawSampleIds].filter((id) => !fixtureMap.has(id) || !goldMap.has(id));
const missingInRaw = [...fixtureMap.keys()].filter((id) => !rawSampleIds.has(id));

// ---------- score ----------
const perSample = [];
const scorerErrors = [];
const arms = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
for (const row of raw) {
  const sampleId = row.tuple.sample_id;
  const fx = fixtureMap.get(sampleId);
  const gd = goldMap.get(sampleId);
  let sample;
  try {
    sample = {
      ...fx,
      expected_action: gd.expected_action,
      acceptable_explanations: gd.acceptable_explanations,
      severe_failure_labels: gd.severe_failure_labels,
      scoring: gd.scoring,
    };
    const scored = scoreSample(sample, row.parsed_structural_output);
    perSample.push({
      tuple_id: row.tuple_id,
      tuple_index: row.tuple_index,
      sample_id: sampleId,
      arm: row.arm,
      task_type: row.task_type,
      execution_mode: row.execution_mode,
      provider_call: row.provider_call,
      status: row.status,
      parse_status: row.parse_status,
      parse_repair_used: row.parse_repair_used,
      contract_errors: row.contract_errors ?? [],
      response_action: row.parsed_structural_output?.action ?? null,
      conflicts: scored.conflicts,
      metrics: scored.metrics,
    });
  } catch (err) {
    scorerErrors.push({ sample_id: sampleId, arm: row.arm, tuple_id: row.tuple_id, error: String(err && err.stack || err) });
  }
}

// ---------- aggregation helpers (mirror scorer internal agg: eligible-only sum/d) ----------
function aggMetrics(rows, metricKeys) {
  const out = {};
  for (const key of metricKeys) {
    const e = rows.map((r) => r.metrics[key]).filter((m) => m && m.eligible);
    out[key] = { n: e.reduce((a, m) => a + m.score, 0), d: e.length, rate: e.length === 0 ? null : e.reduce((a, m) => a + m.score, 0) / e.length };
  }
  return out;
}

const ALL_METRIC_KEYS = Object.keys(perSample[0]?.metrics ?? {});
const PRIMARY_13 = [
  'warranted_decisiveness', 'decision_accuracy', 'unnecessary_abstention_rate', 'arbitrary_decisiveness_rate',
  'evidence_support_rate', 'temporal_validity_rate', 'clarification_efficiency', 'revision_precision',
  'revision_recall', 'decision_stability', 'outcome_adaptation', 'actionability', 'explanation_traceability',
];
const TT_LIST = [...new Set(raw.map((r) => r.task_type))].sort();

// per-arm aggregates via scorer aggregate() (fidelity check) and our aggMetrics
const perArm = {};
for (const arm of arms) {
  const rows = perSample.filter((r) => r.arm === arm);
  const samples = raw.filter((r) => r.arm === arm).map((r) => ({ ...fixtureMap.get(r.tuple.sample_id), expected_action: goldMap.get(r.tuple.sample_id).expected_action, acceptable_explanations: goldMap.get(r.tuple.sample_id).acceptable_explanations, severe_failure_labels: goldMap.get(r.tuple.sample_id).severe_failure_labels, scoring: goldMap.get(r.tuple.sample_id).scoring }));
  const responses = raw.filter((r) => r.arm === arm).map((r) => r.parsed_structural_output);
  const scorerAgg = aggregate(samples, responses); // scorer's own aggregates
  const scorerAggCheck = scorerAgg.aggregates;
  const gates = evaluateGates(samples, responses);
  const myAgg = aggMetrics(rows, ALL_METRIC_KEYS);
  // fidelity: compare scorer aggregate vs our aggMetrics for all keys
  const fidelityDiffs = [];
  for (const key of ALL_METRIC_KEYS) {
    const a = scorerAggCheck[key];
    const b = myAgg[key];
    if (a.d !== b.d || Math.abs((a.score ?? 0) - (b.rate ?? 0)) > 1e-12) fidelityDiffs.push({ key, scorer: a, ours: b });
  }
  // per task type micro aggregates (13 primary + key diagnostics)
  const byTT = {};
  for (const tt of TT_LIST) {
    byTT[tt] = { n_samples: rows.filter((r) => r.task_type === tt).length, metrics: aggMetrics(rows.filter((r) => r.task_type === tt), ALL_METRIC_KEYS) };
  }
  // macro over task types for the 13 primary metrics
  const macro = {};
  for (const key of PRIMARY_13) {
    const ttRates = TT_LIST.map((tt) => byTT[tt].metrics[key]).filter((m) => m.d > 0);
    macro[key] = ttRates.length === 0 ? { rate: null, n_tt: 0 } : { rate: ttRates.reduce((a, m) => a + m.rate, 0) / ttRates.length, n_tt: ttRates.length };
  }
  // action distribution
  const actionDist = {};
  for (const r of rows) actionDist[r.response_action] = (actionDist[r.response_action] || 0) + 1;
  // eligible-subset diagnostics
  const subset = {};
  subset.revision_issued = { d: rows.filter((r) => ['REVISE','REVERSE','INVALIDATE','SUPERSEDE'].includes(r.response_action)).length };
  subset.revision_recall_eligible = myAgg.revision_recall;
  subset.revision_recall = myAgg.revision_recall;
  subset.missed_revision = myAgg.missed_revision_rate;
  subset.revision_precision = myAgg.revision_precision;
  subset.invalid_revision = myAgg.invalid_revision_rate;
  subset.decision_stability = myAgg.decision_stability;
  subset.unwarranted_flapping = myAgg.unwarranted_flapping_rate;
  subset.outcome_adaptation = myAgg.outcome_adaptation;
  subset.temporal_validity = myAgg.temporal_validity_rate;
  subset.temporal_invalid_evidence = myAgg.temporal_invalid_evidence_use_rate;
  subset.unsupported_decision = myAgg.unsupported_decision_rate;
  subset.approval_boundary = myAgg.approval_boundary_violation_rate;
  subset.hard_constraint = myAgg.hard_constraint_violation_rate;
  subset.user_override = myAgg.user_override_violation_rate;
  subset.over_questioning = myAgg.over_questioning_rate;
  subset.clarification_permissibility = myAgg.clarification_permissibility;
  subset.approval_requirement_compliance = myAgg.approval_requirement_compliance;
  subset.mandatory_constraints_honored = myAgg.mandatory_constraints_honored;
  subset.lineage_operation_acceptability = myAgg.lineage_operation_acceptability;
  subset.prohibited_evidence = myAgg.prohibited_evidence_violation;
  subset.required_evidence_coverage = myAgg.required_evidence_coverage;
  subset.clear_correct = myAgg.clear_correct_rate;
  subset.correct_refusal = myAgg.correct_refusal_rate;
  subset.action_acceptability = myAgg.action_acceptability;

  perArm[arm] = {
    n_samples: rows.length,
    aggregates_13: aggMetrics(rows, PRIMARY_13),
    aggregates_all: myAgg,
    scorer_aggregate_fidelity: { diffs: fidelityDiffs, pass: fidelityDiffs.length === 0 },
    gates,
    macro_13: macro,
    by_task_type: byTT,
    action_distribution: actionDist,
    subset,
  };
}

// ---------- integrity post-checks ----------
const scoredCount = perSample.length;
const missingCount = missingInRaw.length;
const duplicateCount = duplicates.length;
const unexpectedCount = unexpectedIds.length;
const scorerErrorCount = scorerErrors.length;
const rawShaAfter = sha256(RAW_FILE);

// ---------- failure labels (design-time trap vocabulary) ----------
const labelCounts = {};
for (const g of gold) for (const lbl of g.severe_failure_labels ?? []) labelCounts[lbl] = (labelCounts[lbl] || 0) + 1;
const perSampleLabels = perSample.map((r) => ({ tuple_id: r.tuple_id, sample_id: r.sample_id, arm: r.arm, labels: goldMap.get(r.sample_id)?.severe_failure_labels ?? [] }));

// ---------- cost summary ----------
let rawCostSum = 0;
for (const r of raw) rawCostSum += r.cost_cny || 0;
const retries = fs.existsSync(path.join(RUN_DIR, 'retries.jsonl')) ? readJsonl(path.join(RUN_DIR, 'retries.jsonl')) : [];
const ledger = JSON.parse(fs.readFileSync(path.join(RUN_DIR, 'budget-ledger.json'), 'utf8'));
const ledgerCalls = ledger.calls ?? (Array.isArray(ledger.records) ? ledger.records.length : 0);
const ledgerSpent = typeof ledger.spent_cny === 'number' ? ledger.spent_cny : 0;

// ---------- write ----------
const result = {
  schema_version: 1,
  purpose: 'GOAL20_FORMAL_SCORING_STAGE_S',
  status: 'SCORED_FROM_FROZEN_RAW_OUTPUTS',
  created_at: new Date().toISOString(),
  run_id: '2026-08-11T17-45-38-164Z-f7f19012',
  campaign: 'goal20-formal-validation-v1',
  identities: {
    raw_outputs_sha256: rawShaBefore,
    fixture_sha256: fixtureSha,
    gold_sha256: goldSha,
    scorer_sha256: scorerSha,
    scorer_blob_sha1: scorerBlobSha1,
    scorer_test_blob_sha1: scorerTestBlobSha1,
    gold_contract_blob_sha1: goldContractBlobSha1,
    metric_definitions_blob_sha1: metricDefsBlobSha1,
    scorer_identity_hash_frozen: '3b4c7a2441bed3ad1b1019b104948f93d59d53ed5bfeaabe307a6e6a5a5ddbbb',
    budget_ledger_sha256: sha256(path.join(RUN_DIR, 'budget-ledger.json')),
    scorer_version: SCORER_VERSION,
    unified_gates: UNIFIED_GATES,
    identity_checks: identityChecks,
    identity_pass: identityPass,
  },
  integrity: {
    scored_tuples: scoredCount,
    missing: missingCount,
    duplicate: duplicateCount,
    unexpected: unexpectedCount,
    scorer_errors: scorerErrorCount,
    scorer_error_detail: scorerErrors,
    raw_sha256_before_scoring: rawShaBefore,
    raw_sha256_after_scoring: rawShaAfter,
    raw_unchanged: rawShaBefore === rawShaAfter,
    all_completed: raw.every((r) => r.status === 'completed'),
    all_parse_ok: raw.every((r) => r.parse_status === 'ok'),
  },
  cost: {
    calls_ledger: ledgerCalls,
    spent_cny_ledger: ledgerSpent,
    retries: retries.length,
    raw_row_cost_sum_cny: Number(rawCostSum.toFixed(6)),
    cost_note: 'calls/spent taken from frozen budget-ledger.json of the V3 run (includes retry attempt usage); raw_row_cost_sum = accepted rows only',
    provider_rows: raw.filter((r) => r.provider_call === true).length,
    kernel_rows: raw.filter((r) => r.provider_call === false).length,
  },
  primary_metrics_13: PRIMARY_13,
  task_types: TT_LIST,
  per_sample: perSample,
  arms: perArm,
  failure_labels: { note: 'design-time trap labels from frozen gold; scorer v1.1 has no runtime label-firing rule, so no per-response label hits are computed (no post-hoc rule invention)', vocabulary_counts: labelCounts, per_sample_labels: perSampleLabels },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2) + '\n', 'utf8');

const outSha = sha256(OUT_FILE);
console.log('identity_pass:', identityPass);
console.log('scored:', scoredCount, 'missing:', missingCount, 'duplicates:', duplicateCount, 'unexpected:', unexpectedCount, 'scorer_errors:', scorerErrorCount);
console.log('raw unchanged:', rawShaBefore === rawShaAfter);
for (const arm of arms) {
  const a = perArm[arm];
  console.log(arm, 'fidelity:', a.scorer_aggregate_fidelity.pass, 'gates.pass:', a.gates.pass, 'hard_gate_compliance d:', a.aggregates_all.hard_gate_compliance.d, 'rate:', a.aggregates_all.hard_gate_compliance.rate);
}
console.log('OUT_FILE:', OUT_FILE);
console.log('OUT_SHA256:', outSha);
console.log('elapsed_ms:', Date.now() - t0);
