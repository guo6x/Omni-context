import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const FIXTURE = path.join(ROOT, 'goal20r-output/validation-v3-r1-fixture.jsonl');
const GOLD = path.join(ROOT, 'goal20r-output/validation-v3-r1-gold.jsonl');
const SCORING = path.join(ROOT, 'goal21-output/goal20-scoring-results-v3-rerun1.json');
const OUT_DIR = path.join(here, 'out');
const PAIRS = path.join(OUT_DIR, 'p0-pairs.jsonl');
const REPORT_JSON = path.join(OUT_DIR, 'p0-recovery-report.json');
const REPORT_MD = path.join(OUT_DIR, 'p0-recovery-report.md');

const readJsonl = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function stableWithoutEvidence(input) {
  const clone = JSON.parse(JSON.stringify(input));
  clone.evidence = { qualified: [], expired: [], conflicting: [] };
  clone.memory_timeline = [];
  clone.candidates = (clone.candidates ?? []).map((c) => ({ ...c, evidence_refs: [] }));
  return JSON.stringify(clone);
}

function main() {
  const fixture = readJsonl(FIXTURE);
  const gold = readJsonl(GOLD);
  const scoring = JSON.parse(fs.readFileSync(SCORING, 'utf8'));
  const pairs = readJsonl(PAIRS);

  const fixtureMap = new Map(fixture.map((s) => [s.sample_id, s]));
  const goldMap = new Map(gold.map((g) => [g.sample_id, g]));

  const formalFailures = scoring.per_sample
    .filter((r) => r.arm === 'A5' && r.metrics?.unsupported_decision_rate?.eligible === true && r.metrics.unsupported_decision_rate.score === 1)
    .map((r) => r.sample_id)
    .sort();

  const expectedFormalFailures = [
    'decision-bench-v3-val-tt08-000',
    'decision-bench-v3-val-tt08-002',
    'decision-bench-v3-val-tt08-004',
    'decision-bench-v3-val-tt08-006',
  ];

  assert(JSON.stringify(formalFailures) === JSON.stringify(expectedFormalFailures),
    `Frozen formal A5 UDR failures drifted: ${JSON.stringify(formalFailures)}`);

  assert(pairs.length === 16, `Expected 16 P0 rows, got ${pairs.length}`);

  const bySample = new Map();
  for (const row of pairs) {
    const list = bySample.get(row.source_sample_id) ?? [];
    list.push(row);
    bySample.set(row.source_sample_id, list);
  }
  assert(bySample.size === 8, `Expected 8 TT08 pairs, got ${bySample.size}`);

  const checks = [];
  for (const [sampleId, rows] of [...bySample.entries()].sort()) {
    const full = rows.find((r) => r.condition === 'FULL');
    const hidden = rows.find((r) => r.condition === 'HIDDEN');
    assert(full && hidden, `${sampleId}: FULL/HIDDEN pair missing`);

    const source = fixtureMap.get(sampleId);
    const gd = goldMap.get(sampleId);
    assert(source && gd, `${sampleId}: source/gold missing`);

    const required = gd.expected_action.required_evidence ?? [];
    const fullIds = new Set(full.policy_input.evidence.qualified.map((e) => e.id));
    const hiddenIds = new Set(hidden.policy_input.evidence.qualified.map((e) => e.id));

    for (const id of required) assert(fullIds.has(id), `${sampleId}: FULL missing required ${id}`);
    assert(!hiddenIds.has('ev002'), `${sampleId}: HIDDEN leaked ev002 into qualified evidence`);
    assert(fullIds.has('ev002'), `${sampleId}: FULL must contain ev002`);

    const ev002 = source.evidence.qualified.find((e) => e.id === 'ev002');
    assert(ev002, `${sampleId}: source ev002 missing`);

    const hiddenText = JSON.stringify(hidden.policy_input);
    assert(!hiddenText.includes('"ev002"'), `${sampleId}: HIDDEN policy_input contains ev002 identifier`);
    assert(!hiddenText.includes(ev002.fact), `${sampleId}: HIDDEN policy_input contains hidden evidence fact`);
    if (ev002.source_ref) {
      const sourceEvent = source.memory_timeline.find((e) => e.event_id === ev002.source_ref);
      assert(!hidden.policy_input.memory_timeline.some((e) => e.event_id === ev002.source_ref),
        `${sampleId}: HIDDEN contains source event ${ev002.source_ref}`);
      if (sourceEvent?.content) {
        assert(!hiddenText.includes(sourceEvent.content),
          `${sampleId}: HIDDEN policy_input contains hidden source content`);
      }
    }

    assert(stableWithoutEvidence(full.policy_input) === stableWithoutEvidence(hidden.policy_input),
      `${sampleId}: pair differs outside evidence/timeline/evidence_refs surface`);

    const a5 = scoring.per_sample.find((r) => r.arm === 'A5' && r.sample_id === sampleId);
    assert(a5, `${sampleId}: A5 row missing`);
    assert(a5.metrics.required_evidence_coverage.score === 0.5,
      `${sampleId}: legacy A5 required-evidence coverage expected 0.5`);

    checks.push({
      sample_id: sampleId,
      authority_level: source.scenario.authority_level,
      legacy_a5_action: a5.response_action,
      legacy_required_evidence_coverage: a5.metrics.required_evidence_coverage.score,
      legacy_udr_eligible: a5.metrics.unsupported_decision_rate.eligible === true,
      legacy_udr_violation: a5.metrics.unsupported_decision_rate.score === 1,
      full_required_coverage: required.every((id) => fullIds.has(id)) ? 1 : 0,
      hidden_required_coverage: required.filter((id) => hiddenIds.has(id)).length / required.length,
      hidden_id: 'ev002',
      hidden_source_ref: ev002.source_ref,
      leak_check: 'PASS',
    });
  }

  const report = {
    schema_version: 1,
    status: 'P0_HARNESS_VERIFIED',
    confirmatory: false,
    provider_calls: 0,
    source: {
      fixture: 'goal20r-output/validation-v3-r1-fixture.jsonl',
      gold: 'goal20r-output/validation-v3-r1-gold.jsonl',
      scoring: 'goal21-output/goal20-scoring-results-v3-rerun1.json',
    },
    recovered_formal_a5_udr_failures: formalFailures,
    recovered_pattern: {
      tt08_rows: 8,
      all_tt08_required_evidence_coverage: 0.5,
      l3plus_decide_udr_failures: 4,
      l2_propose_confirm_not_udr_eligible: 4,
      legacy_missing_mandatory_evidence: 'ev002',
      note: 'P0 verifies repository artifacts and constructs a clean pair. It does not convert the old observation into confirmatory causal evidence.',
    },
    paired_harness: {
      samples: 8,
      conditions_per_sample: 2,
      rows: pairs.length,
      full_required_coverage: 1,
      hidden_required_coverage: 0.5,
      condition_leakage_check: 'PASS',
    },
    checks,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const lines = [
    '# P0 Legacy V3 Recovery Report',
    '',
    '**Status:** P0_HARNESS_VERIFIED',
    '**Confirmatory:** no',
    '**Provider calls:** 0',
    '',
    '## Recovered frozen result',
    '',
    '- Formal A5 UDR failures: ' + formalFailures.join(', '),
    '- All 8 TT08 A5 rows have required-evidence coverage = 0.5.',
    '- TT08 L3+ rows produce DECIDE and are UDR-eligible; the four frozen violations are 000/002/004/006.',
    '- TT08 L2 rows produce PROPOSE_CONFIRM and are not in the frozen UDR denominator.',
    '- The frozen manuscript identifies mandatory ev002 as the lexical-retrieval omission.',
    '',
    '## Paired harness',
    '',
    '- FULL contains all required evidence.',
    '- HIDDEN removes ev002, its source timeline event and candidate evidence references.',
    '- Gold, treatment labels and hidden-evidence metadata remain outside policy_input.',
    '- Exact hidden evidence fact/source content leakage checks pass.',
    '',
    '| sample | authority | legacy A5 | UDR eligible | legacy violation | FULL coverage | HIDDEN coverage |',
    '|---|---:|---|---|---|---:|---:|',
    ...checks.map((c) => `| ${c.sample_id} | ${c.authority_level} | ${c.legacy_a5_action} | ${c.legacy_udr_eligible} | ${c.legacy_udr_violation} | ${c.full_required_coverage.toFixed(1)} | ${c.hidden_required_coverage.toFixed(1)} |`),
    '',
    '## Interpretation',
    '',
    'This is a diagnostic reconstruction only. It validates the P0 treatment machinery and the archived mechanism record. P1/P2 must use a fresh independently validated dataset before any causal claim is made.',
    '',
  ];
  fs.writeFileSync(REPORT_MD, lines.join('\n'), 'utf8');

  console.log('P0_HARNESS_VERIFIED');
  console.log(JSON.stringify(report.recovered_pattern, null, 2));
}

main();
