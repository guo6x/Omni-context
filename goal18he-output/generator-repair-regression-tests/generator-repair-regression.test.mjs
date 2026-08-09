// Goal 18H-E generator repair regression tests.
//
// Covers:
//   - TT03 L0/L1 authority/action repair (REJECT path only, never DECIDE)
//   - TT15 delete-source propagation repair (qualified ev001 sources e004, supports=[])
//   - approval gate / confirmation gate / lineage / source_ref lifecycle via full
//     contract audit on the regenerated Validation V2 output (ERROR=0 per dimension)
//   - deterministic regeneration of the committed Validation V2 artifacts
//   - no HR1 answer / no model output dependence in the repair
//
// Run:
//   node --test generator-repair-regression.test.mjs
//   (or node --test from this directory)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(REPO_ROOT, 'goal18he-output');
const GENERATE = path.join(REPO_ROOT, 'goal18-output', 'scripts', 'generator', 'generate.mjs');
const AUDIT = path.join(OUT, 'scripts', 'audit', 'contract-audit.cjs');
const GEN_RUN = path.join(OUT, 'work', 'regression-tests-run');
const AUDIT_RUN = path.join(OUT, 'work', 'regression-tests-audit');
const SEED = 'goal18-validation-seed-7f3a9c2e';

// Samples changed by the deterministic repair (post-human-review modifications).
// tt03-002: L0 authority slot repaired from DECIDE to REJECT/no_feasible_option.
// tt15-000..007: qualified ev001 re-expressed as evidence of the deletion event.
const MODIFIED_IDS = [
  'decision-bench-v2-val-tt03-002',
  'decision-bench-v2-val-tt15-000',
  'decision-bench-v2-val-tt15-001',
  'decision-bench-v2-val-tt15-002',
  'decision-bench-v2-val-tt15-003',
  'decision-bench-v2-val-tt15-004',
  'decision-bench-v2-val-tt15-005',
  'decision-bench-v2-val-tt15-006',
  'decision-bench-v2-val-tt15-007'
];

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

let generatedSet = [];
let generatedGold = [];
let v2Set = [];
let v2Gold = [];

test('regenerate Validation V2 from the repaired generator (deterministic)', () => {
  fs.rmSync(GEN_RUN, { recursive: true, force: true });
  fs.mkdirSync(GEN_RUN, { recursive: true });
  fs.rmSync(AUDIT_RUN, { recursive: true, force: true });
  execFileSync(process.execPath, [GENERATE, '--split', 'validation', '--seed', SEED, '--outDir', GEN_RUN], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  generatedSet = readJsonl(path.join(GEN_RUN, 'validation-set.jsonl'));
  generatedGold = readJsonl(path.join(GEN_RUN, 'validation-gold.jsonl'));
  v2Set = readJsonl(path.join(OUT, 'validation-v2-fixture.jsonl'));
  v2Gold = readJsonl(path.join(OUT, 'validation-v2-gold.jsonl'));
  assert.equal(generatedSet.length, 120, 'regenerated fixture must have 120 samples');
  assert.equal(generatedGold.length, 120, 'regenerated gold must have 120 samples');
  assert.equal(v2Set.length, 120, 'V2 fixture must have 120 samples');
  assert.equal(v2Gold.length, 120, 'V2 gold must have 120 samples');
});

test('Validation V2 counts: 15 task types x 8', () => {
  const perTt = {};
  for (const s of v2Set) perTt[s.task_type] = (perTt[s.task_type] || 0) + 1;
  assert.equal(Object.keys(perTt).length, 15);
  for (const tt of Object.keys(perTt)) assert.equal(perTt[tt], 8, 'task type ' + tt + ' must have 8 samples');
  const ids = new Set(v2Set.map((s) => s.sample_id));
  assert.equal(ids.size, 120, 'no duplicate sample IDs in V2 fixture');
});

test('regenerated gold is byte-identical to committed V2 gold', async () => {
  const a = await sha256(path.join(GEN_RUN, 'validation-gold.jsonl'));
  const b = await sha256(path.join(OUT, 'validation-v2-gold.jsonl'));
  assert.equal(a, b, 'regenerated gold must byte-match committed V2 gold');
});

test('regenerated fixture matches committed V2 fixture under the provenance assembly rule', () => {
  // Assembly rule: post-review-modified samples keep the repaired generator identity
  // (goal18-generator/v2.1.0); unchanged samples preserve the frozen v2.0.0 identity.
  assert.equal(generatedSet.length, v2Set.length);
  for (let i = 0; i < generatedSet.length; i++) {
    const gen = generatedSet[i];
    const v2 = v2Set[i];
    assert.equal(gen.sample_id, v2.sample_id, 'line ' + (i + 1) + ' sample id mismatch');
    if (MODIFIED_IDS.includes(gen.sample_id)) {
      assert.deepEqual(gen, v2, gen.sample_id + ': modified sample must byte-match V2');
    } else {
      assert.equal(gen.construction_provenance.generator_identity, 'goal18-generator/v2.1.0');
      assert.equal(v2.construction_provenance.generator_identity, 'goal18-generator/v2.0.0');
      const normalized = structuredClone(gen);
      normalized.construction_provenance.generator_identity = 'goal18-generator/v2.0.0';
      assert.deepEqual(normalized, v2, gen.sample_id + ': unchanged sample must match V2 except generator_identity');
    }
  }
});

test('TT03 L0/L1 authority repair: REJECT path only, never DECIDE', () => {
  const goldById = new Map(generatedGold.map((g) => [g.sample_id, g]));
  const tt03 = generatedSet.filter((s) => s.task_type === 'TT03');
  assert.equal(tt03.length, 8);
  for (const s of tt03) {
    const g = goldById.get(s.sample_id);
    assert.ok(g, 'missing gold for ' + s.sample_id);
    const auth = s.scenario.authority_level;
    if (auth !== 'L0' && auth !== 'L1') continue;
    const ea = g.expected_action;
    assert.equal(ea.action, 'REJECT', s.sample_id + ': L0/L1 must be REJECT');
    assert.equal(ea.preferred_action, 'REJECT');
    assert.equal(ea.coded_reason, 'no_feasible_option', s.sample_id + ': coded_reason must be no_feasible_option');
    assert.deepEqual(ea.acceptable_actions, ['REJECT'], s.sample_id + ': acceptable_actions must be [REJECT]');
    assert.ok(ea.prohibited_actions.includes('DECIDE'), s.sample_id + ': DECIDE must be prohibited at L0/L1');
    assert.ok(ea.prohibited_actions.includes('PROPOSE_CONFIRM'));
    assert.ok(s.candidates.length >= 2, s.sample_id + ': must have candidates');
    assert.ok(s.candidates.every((c) => c.violates_hard_constraint === true),
      s.sample_id + ': all candidates must violate a hard constraint (no feasible option)');
  }
});

test('TT15 delete-source propagation repair: qualified ev001 sources e004, supports=[]', () => {
  const goldById = new Map(generatedGold.map((g) => [g.sample_id, g]));
  const tt15 = generatedSet.filter((s) => s.task_type === 'TT15');
  assert.equal(tt15.length, 8);
  for (const s of tt15) {
    const g = goldById.get(s.sample_id);
    const ev001 = s.evidence.qualified.find((e) => e.id === 'ev001');
    const ev002 = s.evidence.qualified.find((e) => e.id === 'ev002');
    const ex001 = s.evidence.expired.find((e) => e.id === 'ex001');
    const e004 = s.memory_timeline.find((e) => e.event_id === 'e004');
    assert.ok(e004, s.sample_id + ': delete event e004 must exist');
    assert.equal(e004.type, 'delete', s.sample_id + ': e004 must be a delete event');
    assert.ok((e004.targets ?? []).includes('e001'), s.sample_id + ': e004 must delete e001');
    assert.ok(ev001, s.sample_id + ': ev001 must exist');
    assert.equal(ev001.source_ref, 'e004', s.sample_id + ': qualified ev001 must source the delete event e004');
    assert.equal(ev001.at, e004.at, s.sample_id + ': ev001.at must equal the delete event timestamp');
    assert.ok(Array.isArray(ev001.supports) && ev001.supports.length === 0,
      s.sample_id + ': ev001 must not support any option (supports=[])');
    assert.equal(ev001.kind, 'fact');
    assert.ok(/撤回|删除/.test(ev001.fact), s.sample_id + ': ev001 fact must describe deletion/withdrawal');
    assert.ok(ex001, s.sample_id + ': ex001 must remain as deleted original evidence');
    assert.equal(ex001.source_ref, 'e001');
    assert.equal(ex001.expiry_reason, 'source_deleted');
    assert.ok(ev002, s.sample_id + ': ev002 cascade-invalidation principle must be preserved');
    assert.equal(ev002.source_ref, 'e003');
    assert.ok(ev002.fact.includes('级联失效'), s.sample_id + ': ev002 must state cascade invalidation');
    // No current qualified evidence may reference the deleted source.
    for (const e of s.evidence.qualified) {
      assert.notEqual(e.source_ref, 'e001', s.sample_id + ': qualified ' + e.id + ' must not source deleted e001');
    }
    // Gold: INVALIDATE with correct lineage, required/prohibited evidence.
    const ea = g.expected_action;
    assert.equal(ea.action, 'INVALIDATE', s.sample_id + ': TT15 gold must be INVALIDATE');
    assert.ok(ea.prohibited_evidence.includes('ex001'), s.sample_id + ': ex001 must be prohibited evidence');
    assert.ok(ea.required_evidence.includes('ev001') && ea.required_evidence.includes('ev002'),
      s.sample_id + ': required evidence must include ev001/ev002');
    assert.ok(ea.acceptable_lineage_operations.some((op) => op.operation === 'invalidate' && op.parent_decision_id === 'decision-d1'),
      s.sample_id + ': lineage must be invalidate(parent=decision-d1)');
  }
});

test('full contract audit on regenerated Validation V2: ERROR=0 across all dimensions', () => {
  fs.mkdirSync(AUDIT_RUN, { recursive: true });
  execFileSync(process.execPath, [
    AUDIT,
    '--data', GEN_RUN,
    '--setFile', 'validation-set.jsonl',
    '--goldFile', 'validation-gold.jsonl',
    '--out', AUDIT_RUN
  ], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const masterFile = path.join(AUDIT_RUN, 'validation-120-contract-audit.csv');
  assert.ok(fs.existsSync(masterFile), 'master audit CSV must exist');
  const lines = fs.readFileSync(masterFile, 'utf8').trim().split('\n');
  const header = lines[0].split(',');
  const dimCols = [
    'authority_action', 'action_eligibility', 'approval_confirmation', 'lineage',
    'evidence', 'constraints', 'clarification', 'deleted_source_provenance', 'referential_integrity', 'overall'
  ];
  const idx = {};
  for (const d of dimCols) {
    const i = header.indexOf(d);
    assert.ok(i >= 0, 'master audit CSV missing column ' + d);
    idx[d] = i;
  }
  assert.equal(lines.length - 1, 120, 'master audit must cover 120 samples');
  const bad = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(',');
    for (const d of dimCols) {
      if (cells[idx[d]] !== 'PASS') bad.push(cells[0] + ':' + d + '=' + cells[idx[d]]);
    }
  }
  assert.deepEqual(bad, [], 'all dimensions must be PASS for all 120 samples');

  // Dimension CSVs must exist and contain no FAIL/AMBIGUOUS/ERROR status rows.
  const dimensionFiles = [
    'authority-action-audit.csv',
    'deleted-source-provenance-audit.csv',
    'validation-action-eligibility-audit.csv',
    'validation-approval-confirmation-audit.csv',
    'validation-lineage-audit.csv',
    'validation-evidence-audit.csv',
    'validation-constraint-audit.csv',
    'validation-clarification-audit.csv'
  ];
  for (const f of dimensionFiles) {
    const p = path.join(AUDIT_RUN, f);
    assert.ok(fs.existsSync(p), f + ' must exist');
    const rows = fs.readFileSync(p, 'utf8').trim().split('\n').slice(1);
    assert.equal(rows.length, 120, f + ' must cover 120 samples');
    const hdr = fs.readFileSync(p, 'utf8').trim().split('\n')[0].split(',');
    const statusIdx = hdr.indexOf('status');
    assert.ok(statusIdx >= 0, f + ' must have status column');
    const fails = rows.filter((row) => row.split(',')[statusIdx] !== 'PASS');
    assert.deepEqual(fails, [], f + ' must have zero FAIL/ERROR rows');
  }
});

test('repair does not depend on HR1 answers or model outputs (source-level invariant)', () => {
  const b0105 = fs.readFileSync(path.join(REPO_ROOT, 'goal18-output', 'scripts', 'generator', 'builders-tt01-05.mjs'), 'utf8');
  const b1115 = fs.readFileSync(path.join(REPO_ROOT, 'goal18-output', 'scripts', 'generator', 'builders-tt11-15.mjs'), 'utf8');
  assert.ok(b0105.includes('Goal 18H-E repair'), 'tt01-05 builder must contain the repair marker');
  assert.ok(b1115.includes('Goal 18H-E repair'), 'tt11-15 builder must contain the repair marker');
  for (const src of [b0105, b1115]) {
    assert.ok(!/\bHR1\b/.test(src), 'builders must not reference HR1 answers');
    assert.ok(!/model\s*output/i.test(src), 'builders must not reference model outputs');
  }
});
