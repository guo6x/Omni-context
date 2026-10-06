import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../../..');
const FIXTURE = path.join(ROOT, 'goal20r-output/validation-v3-r1-fixture.jsonl');
const GOLD = path.join(ROOT, 'goal20r-output/validation-v3-r1-gold.jsonl');
const SCORING = path.join(ROOT, 'goal21-output/goal20-scoring-results-v3-rerun1.json');
const OUT_DIR = path.join(here, 'out');
const OUT_PAIRS = path.join(OUT_DIR, 'p0-pairs.jsonl');

const readJsonl = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const deepClone = (v) => JSON.parse(JSON.stringify(v));
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function buildPolicyInput(sample, hiddenEvidenceIds = new Set()) {
  const hiddenEvidence = sample.evidence.qualified.filter((e) => hiddenEvidenceIds.has(e.id));
  const hiddenSourceRefs = new Set(hiddenEvidence.map((e) => e.source_ref).filter(Boolean));

  const evidence = {
    qualified: sample.evidence.qualified.filter((e) => !hiddenEvidenceIds.has(e.id)),
    expired: sample.evidence.expired.filter((e) => !hiddenEvidenceIds.has(e.id)),
    conflicting: sample.evidence.conflicting.filter((e) => !hiddenEvidenceIds.has(e.id)),
  };

  return {
    sample_id: sample.sample_id,
    task_type: sample.task_type,
    domain: sample.domain,
    scenario: deepClone(sample.scenario),
    decision_question: sample.decision_question,
    goal: deepClone(sample.goal),
    memory_timeline: sample.memory_timeline.filter((e) => !hiddenSourceRefs.has(e.event_id)),
    candidates: sample.candidates.map((c) => ({
      ...deepClone(c),
      evidence_refs: (c.evidence_refs ?? []).filter((id) => !hiddenEvidenceIds.has(id)),
    })),
    hard_constraints: sample.hard_constraints.filter((x) => !hiddenSourceRefs.has(x.source_ref)),
    soft_preferences: sample.soft_preferences.filter((x) => !hiddenSourceRefs.has(x.source_ref)),
    evidence,
    historical_decision: sample.historical_decision,
    execution_outcome: sample.execution_outcome,
  };
}

function main() {
  const fixture = readJsonl(FIXTURE);
  const gold = readJsonl(GOLD);
  const scoring = JSON.parse(fs.readFileSync(SCORING, 'utf8'));
  const goldMap = new Map(gold.map((g) => [g.sample_id, g]));
  const a5 = new Map(
    scoring.per_sample
      .filter((r) => r.arm === 'A5')
      .map((r) => [r.sample_id, r]),
  );

  const tt08 = fixture
    .filter((s) => s.task_type === 'TT08')
    .sort((a, b) => a.sample_id.localeCompare(b.sample_id));

  if (tt08.length !== 8) throw new Error(`Expected 8 TT08 samples, got ${tt08.length}`);

  const records = [];
  for (const sample of tt08) {
    const gd = goldMap.get(sample.sample_id);
    const scoreRow = a5.get(sample.sample_id);
    if (!gd || !scoreRow) throw new Error(`Missing Gold/scoring row for ${sample.sample_id}`);

    const required = gd.expected_action.required_evidence ?? [];
    if (!required.includes('ev002')) {
      throw new Error(`${sample.sample_id}: P0 expects legacy TT08 mandatory ev002`);
    }

    const fullPolicyInput = buildPolicyInput(sample);
    const hiddenPolicyInput = buildPolicyInput(sample, new Set(['ev002']));
    const hiddenEv = sample.evidence.qualified.find((e) => e.id === 'ev002');
    if (!hiddenEv) throw new Error(`${sample.sample_id}: ev002 missing from qualified evidence`);

    const common = {
      schema_version: 1,
      study_phase: 'P0_DIAGNOSTIC',
      source_sample_id: sample.sample_id,
      legacy: {
        authority_level: sample.scenario.authority_level,
        a5_action: scoreRow.response_action,
        a5_udr_eligible: scoreRow.metrics?.unsupported_decision_rate?.eligible === true,
        a5_udr_violation: scoreRow.metrics?.unsupported_decision_rate?.score === 1,
        a5_required_evidence_coverage: scoreRow.metrics?.required_evidence_coverage?.score ?? null,
      },
      required_evidence_ids: required,
      hidden_evidence_id: 'ev002',
      hidden_source_refs: [hiddenEv.source_ref].filter(Boolean),
      hidden_evidence_fact_sha256: sha256(hiddenEv.fact ?? ''),
    };

    records.push({
      ...common,
      pair_id: `${sample.sample_id}::FULL`,
      condition: 'FULL',
      policy_input: fullPolicyInput,
    });
    records.push({
      ...common,
      pair_id: `${sample.sample_id}::HIDDEN`,
      condition: 'HIDDEN',
      policy_input: hiddenPolicyInput,
    });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PAIRS, records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  console.log(`wrote ${records.length} rows -> ${path.relative(ROOT, OUT_PAIRS)}`);
}

main();
