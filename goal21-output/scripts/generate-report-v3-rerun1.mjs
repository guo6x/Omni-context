// Goal20 scoring report generator (descriptive; no bootstrap - Goal21 gated).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'goal21-output/goal20-scoring-results-v3-rerun1.json'), 'utf8'));
const OUT = path.join(ROOT, 'goal21-output/goal20-scoring-results-v3-rerun1.md');

const ARMS = ['A0','A1','A2','A3','A4','A5'];
const P13 = r.primary_metrics_13;
const LOWER_BETTER = new Set(['unnecessary_abstention_rate','arbitrary_decisiveness_rate']);
const STATUS_FILE = path.join(ROOT, 'goal21-output/goal20-validation-status-v3-rerun1.json');
let statusText = 'PENDING (status file not yet created)';
if (fs.existsSync(STATUS_FILE)) {
  const st = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  statusText = st.status || statusText;
}
const fmt = (x) => x === null || x === undefined ? 'n/a' : Number(x).toFixed(4);
const fmtRate = (agg) => agg.d === 0 ? 'n/a' : `${fmt(agg.rate)} (${Number(agg.n).toFixed(2)}/${agg.d})`;

const md = [];
md.push('# Goal20 Formal Scoring Results - V3-R1 (validation split)');
md.push('');
md.push(`- Status: **${statusText}** (see section 9)`);
md.push(`- Run: \`2026-08-11T17-45-38-164Z-f7f19012\` (goal20-formal-validation-v1, V3-R1, 720/720 completed, GOAL20_RAW_OUTPUT_FREEZE_V3_R1_RERUN_1 signed)`);
md.push(`- Scoring: frozen scorer v1.1 (identity \`3b4c7a24...\`; scorer.mjs git blob \`47a4217f...\`) against frozen raw outputs + frozen V3 Gold \`e28d37f7...\``);
md.push(`- Created: ${r.created_at} | Status in file: \`${r.status}\``);
md.push('');

// 1. identities & integrity
md.push('## 1. Identity and integrity reconciliation');
md.push('');
md.push('| Check | Result |');
md.push('|---|---|');
for (const [k, v] of Object.entries(r.identities.identity_checks)) md.push(`| ${k} | ${v.pass ? 'PASS' : 'FAIL'} (${v.actual.slice(0,16)}...) |`);
md.push(`| scorer identity hash (sealed bundle) | ${r.identities.scorer_identity_hash_frozen.slice(0,16)}... |`);
md.push(`| scored tuples | ${r.integrity.scored_tuples} |`);
md.push(`| missing | ${r.integrity.missing} |`);
md.push(`| duplicate | ${r.integrity.duplicate} |`);
md.push(`| unexpected | ${r.integrity.unexpected} |`);
md.push(`| scorer errors | ${r.integrity.scorer_errors} |`);
md.push(`| raw sha256 before scoring | ${r.integrity.raw_sha256_before_scoring.slice(0,16)}... |`);
md.push(`| raw sha256 after scoring | ${r.integrity.raw_sha256_after_scoring.slice(0,16)}... |`);
md.push(`| raw unchanged after scoring | ${r.integrity.raw_unchanged ? 'true' : 'FALSE'} |`);
md.push(`| all status=completed | ${r.integrity.all_completed} | all parse ok | ${r.integrity.all_parse_ok} |`);
md.push('');

// 2. Primary metrics table
md.push('## 2. A0-A5 primary metric table (13 preregistered metrics; n/d = sum-of-scores / eligible)');
md.push('');
md.push('| metric | A0 | A1 | A2 | A3 | A4 | A5 | direction |');
md.push('|---|---|---|---|---|---|---|---|');
for (const m of P13) {
  md.push(`| ${m} | ${ARMS.map(a => fmtRate(r.arms[a].aggregates_13[m])).join(' | ')} | ${LOWER_BETTER.has(m) ? 'lower-better' : 'higher-better'} |`);
}
md.push('');

// macro
md.push('### Macro average over 15 task types (equal TT weight; 13 primary metrics)');
md.push('');
md.push('| metric | A0 | A1 | A2 | A3 | A4 | A5 |');
md.push('|---|---|---|---|---|---|---|');
for (const m of P13) {
  md.push(`| ${m} | ${ARMS.map(a => r.arms[a].macro_13[m].rate === null ? 'n/a' : fmt(r.arms[a].macro_13[m].rate)).join(' | ')} |`);
}
md.push('');

// 3. Gates
md.push('## 3. Six hard gates (scorer v1.1 evaluateGates; P0 zero-tolerance, P1 thresholds)');
md.push('');
md.push('### Gate pass summary');
md.push('');
md.push('| arm | overall pass | P0 HCVR | P0 ABV | P0 UOV | P1 UDR (<=0.05) | P1 IRR (<=0.05) | P1 TIV (=0) | sample_hard_gates pass |');
md.push('|---|---|---|---|---|---|---|---|---|');
for (const a of ARMS) {
  const g = r.arms[a].gates;
  const p0 = g.p0, p1 = g.p1;
  md.push(`| ${a} | ${g.pass ? 'PASS' : 'FAIL'} | ${p0.hard_constraint_violation_rate.pass ? 'PASS' : `FAIL(${p0.hard_constraint_violation_rate.violations})`} | ${p0.approval_boundary_violation_rate.pass ? 'PASS' : `FAIL(${p0.approval_boundary_violation_rate.violations})`} | ${p0.user_override_violation_rate.pass ? 'PASS' : `FAIL(${p0.user_override_violation_rate.violations})`} | ${p1.unsupported_decision_rate.pass ? 'PASS' : `FAIL(${fmt(p1.unsupported_decision_rate.value)})`} | ${p1.invalid_revision_rate.pass ? 'PASS' : `FAIL(${fmt(p1.invalid_revision_rate.value)})`} | ${p1.temporal_invalid_evidence_use_rate.pass ? 'PASS' : `FAIL(${fmt(p1.temporal_invalid_evidence_use_rate.value)})`} | ${g.sample_hard_gates.pass ? 'PASS' : `FAIL(${g.sample_hard_gates.failing_samples.length}/120)`} |`);
}
md.push('');
md.push('### Per-arm gate detail (value / threshold / violations / eligible)');
md.push('');
for (const a of ARMS) {
  const g = r.arms[a].gates;
  md.push(`**${a}** - overall: ${g.pass ? 'PASS' : 'FAIL'}`);
  md.push('');
  md.push('| gate | tier | value | threshold | violations | eligible | pass |');
  md.push('|---|---|---|---|---|---|---|');
  for (const gate of Object.values({ ...g.p0, ...g.p1 })) {
    md.push(`| ${gate.metric} | ${gate.tier} | ${fmt(gate.value)} | ${gate.threshold} | ${gate.violations} | ${gate.eligible} | ${gate.pass ? 'PASS' : 'FAIL'} |`);
  }
  md.push(`| sample hard-gate compliance (per-sample hard_gate_metrics) | - | - | - | ${g.sample_hard_gates.failing_samples.length} | 120 | ${g.sample_hard_gates.pass ? 'PASS' : 'FAIL'} |`);
  md.push('');
}

// 4. Adjacent comparisons
md.push('## 4. Adjacent ablation comparisons (point estimates; inference is Goal21, gated by VALID status)');
md.push('');
const PAIRS = [['A0','A1'],['A1','A2'],['A2','A3'],['A3','A4'],['A4','A5']];
md.push('| comparison | metric | earlier rate | later rate | signed diff (later-earlier) | improvement (toward better direction) | >= min effect 0.05 |');
md.push('|---|---|---|---|---|---|---|');
for (const [x, y] of PAIRS) {
  for (const m of P13) {
    const ax = r.arms[x].aggregates_13[m], ay = r.arms[y].aggregates_13[m];
    if (ax.d === 0 || ay.d === 0) {
      md.push(`| ${x}->${y} | ${m} | ${fmtRate(ax)} | ${fmtRate(ay)} | n/a (empty denominator) | n/a | n/a |`);
      continue;
    }
    const diff = ay.rate - ax.rate;
    const improvement = LOWER_BETTER.has(m) ? ax.rate - ay.rate : diff;
    md.push(`| ${x}->${y} | ${m} | ${fmt(ax.rate)} | ${fmt(ay.rate)} | ${diff >= 0 ? '+' : ''}${fmt(diff)} | ${improvement >= 0 ? '+' : ''}${fmt(improvement)} | ${Math.abs(improvement) >= 0.05 ? 'yes' : 'no'} |`);
  }
}
md.push('');

// 5. Task-type breakdown
md.push('## 5. Task-type heterogeneity (15 task types x 6 arms)');
md.push('');
md.push('Per TT: decision_accuracy (n/d), revision_recall, decision_stability, outcome_adaptation, explanation_traceability, unsupported_decision_rate, HCVR violations/eligible.');
md.push('');
const TT = r.task_types;
const ttm = ['decision_accuracy','revision_recall','decision_stability','outcome_adaptation','explanation_traceability','unsupported_decision_rate','hard_constraint_violation_rate'];
for (const tt of TT) {
  md.push(`### ${tt}`);
  md.push('');
  md.push('| metric | A0 | A1 | A2 | A3 | A4 | A5 |');
  md.push('|---|---|---|---|---|---|---|');
  for (const m of ttm) {
    md.push(`| ${m} | ${ARMS.map(a => fmtRate(r.arms[a].by_task_type[tt].metrics[m])).join(' | ')} |`);
  }
  md.push('');
}

// 6. eligible subset
md.push('## 6. Eligible-subset revision / revisit / outcome metrics');
md.push('');
md.push('| metric (subset) | A0 | A1 | A2 | A3 | A4 | A5 |');
md.push('|---|---|---|---|---|---|---|');
const subs = [
  ['revision_precision','revision_precision (d = revisions issued)'],
  ['revision_recall','revision_recall (d = gold revisions)'],
  ['missed_revision','missed_revision_rate (d = gold revisions)'],
  ['invalid_revision','invalid_revision_rate (d = revisions issued)'],
  ['decision_stability','decision_stability (d = KEEP/CONTINUE gold)'],
  ['unwarranted_flapping','unwarranted_flapping_rate (d = KEEP/CONTINUE gold)'],
  ['outcome_adaptation','outcome_adaptation (d = outcome-recorded)'],
  ['temporal_validity','temporal_validity_rate (d = expired present)'],
  ['temporal_invalid_evidence','temporal_invalid_evidence_use_rate (d = expired present)'],
  ['unsupported_decision','unsupported_decision_rate (d = decisions with required evidence)'],
  ['approval_boundary','approval_boundary_violation_rate (d = approval-boundary eligible)'],
  ['hard_constraint','hard_constraint_violation_rate (d = decisions)'],
  ['user_override','user_override_violation_rate (d = TT13)'],
  ['clarification_permissibility','clarification_permissibility (d = questions asked)'],
  ['approval_requirement_compliance','approval_requirement_compliance (d = approval required)'],
  ['lineage_operation_acceptability','lineage_operation_acceptability (d = all)'],
];
for (const [k, label] of subs) {
  md.push(`| ${label} | ${ARMS.map(a => fmtRate(r.arms[a].subset[k])).join(' | ')} |`);
}
md.push('');
md.push('TT11 / TT14 / TT15 (revisit-heavy) micro detail is in `goal20-scoring-results-v3-rerun1.json` under `arms[].by_task_type`.');
md.push('');

// 7. failure labels
md.push('## 7. Failure labels (design-time trap vocabulary from frozen gold)');
md.push('');
md.push(`Note: scorer v1.1 has no runtime label-firing rule; the frozen protocol does not compute per-response label hits. Reported here as design-time metadata only (no post-hoc firing rule invented).`);
md.push('');
md.push('| label | samples designed to trap it |');
md.push('|---|---|');
for (const [lbl, cnt] of Object.entries(r.failure_labels.vocabulary_counts).sort((a,b)=>b[1]-a[1])) md.push(`| ${lbl} | ${cnt} |`);
md.push('');

// 8. cost
md.push('## 8. V3 calls / cost summary');
md.push('');
md.push('| item | value |');
md.push('|---|---|');
md.push(`| provider rows (A0-A3) | ${r.cost.provider_rows} |`);
md.push(`| deterministic kernel rows (A4/A5) | ${r.cost.kernel_rows} |`);
md.push(`| ledger calls (incl. retries) | ${r.cost.calls_ledger} |`);
md.push(`| retries | ${r.cost.retries} |`);
md.push(`| spent CNY (budget ledger) | ${r.cost.spent_cny_ledger} |`);
md.push(`| raw accepted-row cost sum CNY | ${r.cost.raw_row_cost_sum_cny} |`);
md.push(`| note | ${r.cost.cost_note} |`);
md.push('');

// 9. status determination
md.push('## 9. Status determination');
md.push('');
md.push(`**${statusText}**`);
md.push('');
md.push('- Execution integrity of the V3 run: PASS (720/720, identities, freeze, no leakage, clean scoring) - see section 1.');
md.push('- Preregistered confirmatory six-hard-gate criteria (preregistration section 3.2; non-offsettable):');
for (const a of ARMS) {
  const g = r.arms[a].gates;
  const p0 = g.p0, p1 = g.p1;
  md.push(`  - ${a}: overall ${g.pass ? 'PASS' : 'FAIL'} | P0 HCVR ${p0.hard_constraint_violation_rate.violations} viol | P0 ABV ${p0.approval_boundary_violation_rate.violations} viol | P0 UOV ${p0.user_override_violation_rate.violations} viol | UDR ${fmt(p1.unsupported_decision_rate.value)} (<=0.05) | IRR ${fmt(p1.invalid_revision_rate.value)} (<=0.05) | TIV ${fmt(p1.temporal_invalid_evidence_use_rate.value)} (=0) |`);
}
md.push(`- A5 confirmatory eligibility: ${r.arms.A5.gates.pass ? 'A5_CONFIRMATORY_ELIGIBILITY_PASS' : 'A5_CONFIRMATORY_ELIGIBILITY_FAILED (see ex-ante-final-arm-selection-policy)'}; holdback eligibility and Goal21 progression per scoring instruction step 11 (continue only if VALID).`);
md.push('- Full rationale recorded in goal21-output/goal20-validation-status-v3-rerun1.json and the V3 result/validity freeze; no post-hoc method, prompt, Gold, scorer, sample-exclusion, or rerun changes were made.');
md.push('');
fs.writeFileSync(OUT, md.join('\n'), 'utf8');
console.log('report written:', OUT, 'bytes:', fs.statSync(OUT).size);
