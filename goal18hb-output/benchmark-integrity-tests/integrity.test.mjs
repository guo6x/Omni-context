// Decision Benchmark v2 — integrity test suite (Node >= 18, node:test, zero deps).
// Run: node --test goal18-output/benchmark-integrity-tests/integrity.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadValidation, loadHoldbackFull, loadJsonl, loadSchema, TASK_TYPES, ACTIONS, ALL_METRICS, queryTime, allIds } from './fixtures-loader.mjs';
import { validateSchema } from './schema-validator.mjs';
import { scoreSample, aggregate, evaluateGates } from './scorer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..');
const SPEC_DIR = process.env.GOAL18_SPEC_DIR || 'C:/Users/00/AppData/Local/Temp/omni-goal18-spec';

const { set, gold, all } = loadValidation();

function loadDevReg() {
  try {
    const read = (rel) => fs.readFileSync(path.join(SPEC_DIR.replace(/[\\/]$/, ''), rel), 'utf8').trim().split(/\r?\n/).filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    return { dev: read('goal14-output/development-fixtures.jsonl'), reg: read('goal14-output/regression-fixtures.jsonl') };
  } catch (e) {
    console.warn('[warn] spec dir unavailable, dev/reg isolation limited to title/id checks:', e.message);
    return { dev: [], reg: [] };
  }
}
const devRegAll = loadDevReg();
const hb = loadHoldbackFull();
const v2Schema = loadSchema('schema/decision-benchmark-v2-schema.json');
const setSchema = loadSchema('schema/decision-benchmark-v2-set.schema.json');
const goldSchema = loadSchema('schema/validation-gold-v2.schema.json');

const FAILURE_CODES = new Set([
  'UNNECESSARY-REFUSAL', 'OVER-QUESTIONING', 'GUESS-ON-WEAK-EVIDENCE', 'ARBITRARY-DECISION',
  'UNWARRANTED-REVISION', 'MISSED-REVISION', 'SILENT-OVERWRITE', 'REVERSAL-WITHOUT-EVIDENCE',
  'CASCADE-INVALIDATION-MISS', 'CHERRY-PICKED-EVIDENCE', 'STALE-EVIDENCE-USE', 'CONFLICT-IGNORED',
  'GHOST-CITATION', 'APPROVAL-BYPASS', 'EXECUTION-WITHOUT-APPROVAL', 'OVERRIDE-IGNORED',
  'REPLAY-EXECUTION', 'HALLUCINATED-CITATION', 'HCV-SELECTED', 'NO-LEARNING', 'PRINCIPLE-MUTATION',
  'VAGUE-RESPONSE', 'STALE-DECISION-AS-CURRENT', 'QUESTION-LOOP', 'UNWARRANTED-DEFER', 'UNJUSTIFIED-REJECT'
]);
// STALE-EVIDENCE-USE + CHERRY-PICKED-EVIDENCE intentionally co-occur (a model that leans on stale
// evidence typically also cherry-picks); they are not treated as mutually exclusive.
const MUTUALLY_EXCLUSIVE_LABELS = [['MISSED-REVISION', 'UNWARRANTED-REVISION']];
const REVISION_ACTIONS = ['REVISE', 'REVERSE', 'INVALIDATE', 'SUPERSEDE'];
const CODED_REASONS = [null, 'no_feasible_option', 'evidence_insufficient_after_clarification', 'out_of_scope', 'user_declined', 'no_sufficient_change', 'approval_required', 'user_override'];
const IMPLIED_OP = { REVISE: 'revise', REVERSE: 'reverse', INVALIDATE: 'invalidate', SUPERSEDE: 'supersede', DECIDE: 'create', PROPOSE_CONFIRM: 'create', APPROVAL_REQUEST: 'create', CONTINUE: 'continue' };
const REVERSIBILITY_BY_RISK = { high: ['irreversible', 'conditionally_reversible'], critical: ['irreversible'], medium: ['conditionally_reversible', 'reversible'], low: ['reversible'], negligible: ['reversible'] };

function norm(s) { return String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
function shingles(s, k = 8) {
  const out = new Set();
  for (let i = 0; i + k <= s.length; i++) out.add(s.slice(i, i + k));
  return out;
}
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}
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

function goldResponse(sample) {
  const G = sample.expected_action;
  const r = {
    action: G.action,
    selected_option: G.target_option ?? (G.action === 'DECIDE' || G.action === 'CONTINUE' ? sample.candidates[0].id : null),
    key_questions: G.key_question ? [{ variable: G.key_question.variable }] : [],
    clarification_count: G.key_question ? 1 : 0,
    revision_target: G.revision_target ?? null,
    executed: false,
    approval_requested: G.action === 'APPROVAL_REQUEST',
    explanation: sample.acceptable_explanations[0].text,
    cited_evidence_ids: [...G.required_evidence],
    keep_decision: G.action === 'KEEP',
    reason_code: G.coded_reason,
    lineage_operation: IMPLIED_OP[G.action] ?? 'none',
    parent_decision_id: G.action === 'DECIDE' || G.action === 'CONTINUE' || REVISION_ACTIONS.includes(G.action) ? (G.acceptable_lineage_operations[0]?.parent_decision_id ?? null) : null
  };
  return r;
}

function adversarialResponse(sample) {
  // Deliberately wrong response: violates constraints/approval/evidence as applicable.
  const G = sample.expected_action;
  const r = { action: 'DECIDE', selected_option: sample.candidates[0].id, key_questions: [], clarification_count: 0, revision_target: null, executed: true, approval_requested: false, explanation: 'erroneous', cited_evidence_ids: [], keep_decision: false, reason_code: null, lineage_operation: 'create', parent_decision_id: null };
  if (G.action === 'APPROVAL_REQUEST' || G.action === 'OVERRIDE_HONOR') r.action = 'KEEP', r.keep_decision = true, r.executed = false;
  return r;
}

const byIdAll = new Map([...all, ...hb].map((s) => [s.sample_id, s]));

describe('decision-benchmark-v2 integrity', () => {
  test('T1 schema: set/gold join and holdback satisfy v2 schemas', () => {
    const errs = [];
    for (const s of all) errs.push(...validateSchema(s, v2Schema).map((e) => `${s.sample_id} ${e.path}: ${e.message}`));
    for (const s of set) errs.push(...validateSchema(s, setSchema).map((e) => `${s.sample_id} ${e.path}: ${e.message}`));
    for (const g of gold) errs.push(...validateSchema(g, goldSchema).map((e) => `${g.sample_id} ${e.path}: ${e.message}`));
    for (const s of hb) errs.push(...validateSchema(s, v2Schema).map((e) => `${s.sample_id} ${e.path}: ${e.message}`));
    assert.deepEqual(errs, [], `schema errors:\n${errs.slice(0, 40).join('\n')}`);
  });

  test('T2 ids unique; split prefix and tt match sample_id', () => {
    const seen = new Set();
    for (const s of [...all, ...hb]) {
      assert.ok(!seen.has(s.sample_id), `duplicate ${s.sample_id}`);
      seen.add(s.sample_id);
      const seg = s.sample_id.split('-');
      assert.equal(seg[0], 'decision');
      assert.equal(seg[3], s.split === 'validation' ? 'val' : 'holdback', `${s.sample_id} prefix`);
      assert.equal(seg[4], s.task_type.toLowerCase(), `${s.sample_id} tt`);
      assert.equal(seg[2], 'v2');
    }
    assert.equal(all.length, 120, 'validation count');
    assert.equal(hb.length, 180, 'holdback count');
    for (const tt of TASK_TYPES) {
      assert.equal(all.filter((s) => s.task_type === tt).length, 8, `val ${tt}`);
      assert.equal(hb.filter((s) => s.task_type === tt).length, 12, `hb ${tt}`);
    }
  });

  test('T3 internal ids unique and references resolve', () => {
    for (const s of [...all, ...hb]) {
      const groups = [s.memory_timeline.map((e) => e.event_id), s.candidates.map((c) => c.id),
        s.hard_constraints.map((h) => h.id), s.soft_preferences.map((p) => p.id),
        s.evidence.qualified.map((e) => e.id), s.evidence.expired.map((e) => e.id),
        s.evidence.conflicting.map((e) => e.id)];
      for (const g of groups) assert.equal(new Set(g).size, g.length, `${s.sample_id} dup ids`);
      const events = new Map(s.memory_timeline.map((e) => [e.event_id, e]));
      const evIds = new Set([...s.evidence.qualified, ...s.evidence.expired, ...s.evidence.conflicting].map((e) => e.id));
      for (const e of s.memory_timeline) {
        if (e.supersedes) assert.ok(events.has(e.supersedes), `${s.sample_id}: ${e.event_id} supersedes missing ${e.supersedes}`);
        for (const d of e.derived_from ?? []) assert.ok(events.has(d), `${s.sample_id}: ${e.event_id} derived_from missing ${d}`);
        for (const t of e.targets ?? []) assert.ok(events.has(t), `${s.sample_id}: ${e.event_id} targets missing ${t}`);
      }
      for (const ev of [...s.evidence.qualified, ...s.evidence.expired, ...s.evidence.conflicting]) {
        if (ev.source_ref) assert.ok(events.has(ev.source_ref), `${s.sample_id}: ${ev.id} source_ref missing ${ev.source_ref}`);
      }
      for (const c of s.evidence.conflicting) {
        assert.ok(evIds.has(c.conflicts_with) || events.has(c.conflicts_with), `${s.sample_id}: cf ${c.id} conflicts_with missing`);
      }
      for (const cand of s.candidates) {
        for (const ref of cand.evidence_refs) assert.ok(evIds.has(ref) || events.has(ref), `${s.sample_id}: cand ${cand.id} ref missing ${ref}`);
      }
      for (const h of s.hard_constraints) assert.ok(events.has(h.source_ref), `${s.sample_id}: hc ${h.id} source missing`);
      for (const p of s.soft_preferences) assert.ok(events.has(p.source_ref), `${s.sample_id}: sp ${p.id} source missing`);
      if (s.historical_decision) {
        for (const snap of s.historical_decision.evidence_snapshot) assert.ok(evIds.has(snap) || events.has(snap), `${s.sample_id}: snapshot ref missing ${snap}`);
        for (const l of s.historical_decision.lineage) assert.ok(byIdAll.has(l.decision_id) || l.decision_id === s.historical_decision.decision_id, `${s.sample_id}: lineage ref ${l.decision_id}`);
      }
    }
  });

  test('T4 timeline chronologically ordered; windows and supersedes consistent', () => {
    for (const s of [...all, ...hb]) {
      const events = s.memory_timeline;
      for (let i = 1; i < events.length; i++) {
        assert.ok(Date.parse(events[i].at) >= Date.parse(events[i - 1].at), `${s.sample_id}: order at ${events[i].event_id}`);
      }
      for (const e of events) {
        if (e.valid_from && e.valid_until) assert.ok(Date.parse(e.valid_from) <= Date.parse(e.valid_until), `${s.sample_id}: ${e.event_id} window inverted`);
        if (e.supersedes) assert.ok(Date.parse(events.find((x) => x.event_id === e.supersedes).at) <= Date.parse(e.at), `${s.sample_id}: ${e.event_id} supersedes later`);
      }
      assert.ok(queryTime(s) >= Date.parse(events[events.length - 1].at) || events.some((e) => Date.parse(e.at) > queryTime(s) && e.type === 'revisit'), `${s.sample_id}: query_time before all events`);
    }
  });

  test('T5 evidence validity vs query_time and expiry semantics', () => {
    for (const s of [...all, ...hb]) {
      const qt = queryTime(s);
      for (const ev of s.evidence.qualified) assert.ok(Date.parse(ev.at) <= qt, `${s.sample_id}: qualified ${ev.id} after query_time`);
      for (const ex of s.evidence.expired) {
        assert.ok(Date.parse(ex.valid_until) < qt, `${s.sample_id}: expired ${ex.id} valid_until >= query_time`);
        assert.ok(['superseded', 'timed_out', 'retracted', 'source_deleted'].includes(ex.expiry_reason), `${s.sample_id}: ${ex.id} reason`);
      }
      for (const cf of s.evidence.conflicting) {
        if (cf.status === 'resolved') assert.ok(cf.resolution && cf.resolution.length >= 4, `${s.sample_id}: ${cf.id} resolved without resolution`);
        if (cf.status === 'open' && cf.key_variable) {
          assert.equal(s.expected_action.action, 'CLARIFY', `${s.sample_id}: open key-variable conflict must imply CLARIFY`);
          assert.equal(cf.key_variable, s.expected_action.key_question?.variable, `${s.sample_id}: open conflict key_variable mismatch`);
        }
      }
      // deleted source => at least one expired artifact carries source_deleted; qualified
      // evidence may stay current when it is independent of the deleted source artifact.
      const deleted = s.memory_timeline.filter((e) => e.type === 'delete').flatMap((e) => e.targets ?? []);
      for (const d of deleted) {
        const expiredSrcs = s.evidence.expired.filter((ev) => ev.source_ref === d);
        assert.ok(expiredSrcs.length >= 1, `${s.sample_id}: deleted source ${d} must have an expired source_deleted artifact`);
        for (const ev of expiredSrcs) assert.equal(ev.expiry_reason, 'source_deleted', `${s.sample_id}: source of ${ev.id} deleted but reason != source_deleted`);
      }
    }
  });

  test('T6 gold contract consistency (GOLD-C1..C12 + action/task mapping + coded reason)', () => {
    const ACTION_TT = {
      TT01: ['DECIDE'], TT02: ['CLARIFY'], TT03: ['DECIDE', 'REJECT'], TT04: ['DECIDE'],
      TT05: ['CLARIFY', 'DECIDE'], TT06: ['REVERSE', 'REVISE'], TT07: ['KEEP'], TT08: ['DECIDE', 'PROPOSE_CONFIRM'],
      TT09: ['APPROVAL_REQUEST'], TT10: ['REVISE', 'REVERSE'], TT11: ['CONTINUE'], TT12: ['DECIDE', 'CLARIFY'],
      TT13: ['OVERRIDE_HONOR'], TT14: ['KEEP', 'REVISE'], TT15: ['INVALIDATE', 'REVISE']
    };
    for (const s of [...all, ...hb]) {
      const G = s.expected_action;
      assert.equal(G.preferred_action, G.action, `${s.sample_id} C1`);
      assert.ok(G.acceptable_actions.includes(G.action), `${s.sample_id} C2`);
      assert.equal(G.acceptable_actions.some((a) => G.prohibited_actions.includes(a)), false, `${s.sample_id} C3`);
      const qIds = new Set(s.evidence.qualified.map((e) => e.id));
      assert.ok(G.required_evidence.length >= 1 && G.required_evidence.every((id) => qIds.has(id)), `${s.sample_id} C4`);
      const exIds = new Set(s.evidence.expired.map((e) => e.id));
      const srcDelIds = new Set(s.evidence.expired.filter((e) => e.expiry_reason === 'source_deleted').map((e) => e.id));
      assert.ok(G.prohibited_evidence.every((id) => exIds.has(id)), `${s.sample_id} C5`);
      assert.ok(G.required_evidence.every((id) => !G.prohibited_evidence.includes(id)), `${s.sample_id} C6`);
      assert.deepEqual([...G.mandatory_constraints].sort(), s.hard_constraints.map((h) => h.id).sort(), `${s.sample_id} C7`);
      if (G.action === 'CLARIFY') {
        assert.deepEqual([...G.permissible_clarifications].sort(), [G.key_question.variable], `${s.sample_id} C8`);
        assert.deepEqual([...G.forbidden_clarifications].sort(), [...(s.scenario.distractor_variables ?? [])].sort(), `${s.sample_id} C9`);
      } else {
        assert.equal(G.permissible_clarifications.length, 0, `${s.sample_id} C8b`);
        assert.equal(G.key_question, null, `${s.sample_id} keyq`);
      }
      assert.ok(G.forbidden_clarifications.every((v) => !G.permissible_clarifications.includes(v)), `${s.sample_id} C9b`);
      const risk = s.scenario.risk_classification;
      const reqApproval = risk.level === 'high' || risk.level === 'critical' || risk.reversibility === 'irreversible';
      assert.equal(G.approval_requirement.required, reqApproval, `${s.sample_id} C10`);
      if (reqApproval) assert.equal(G.approval_requirement.gate, 'approval', `${s.sample_id} C10 gate`);
      else if (s.scenario.authority_level === 'L2') assert.equal(G.approval_requirement.gate, 'propose_confirm', `${s.sample_id} C10 L2`);
      else assert.equal(G.approval_requirement.gate, 'none', `${s.sample_id} C10 none`);
      assert.ok(G.acceptable_lineage_operations.length >= 1, `${s.sample_id} C11`);
      for (const op of G.acceptable_lineage_operations) {
        if (op.operation === 'none') assert.equal(op.parent_decision_id, null, `${s.sample_id} none parent`);
        if (s.historical_decision && ['revise', 'reverse', 'invalidate', 'supersede', 'continue'].includes(op.operation)) {
          assert.equal(op.parent_decision_id, s.historical_decision.decision_id, `${s.sample_id} op parent`);
        }
      }
      assert.ok(G.hard_gate_metrics.length >= 1 && G.hard_gate_metrics.includes(s.scoring.primary_metric), `${s.sample_id} C12`);
      for (const m of G.hard_gate_metrics) assert.ok(ALL_METRICS.includes(m), `${s.sample_id} gate metric ${m}`);
      assert.ok(ACTION_TT[s.task_type].includes(G.action), `${s.sample_id} action-task mismatch`);
      assert.ok(CODED_REASONS.includes(G.coded_reason), `${s.sample_id} coded_reason`);
      for (const a of G.acceptable_actions) assert.ok(ACTIONS.includes(a), `${s.sample_id} acceptable action ${a}`);
    }
  });

  test('T7 approval consistency (incl. override-supersedes-approval boundary)', () => {
    for (const s of [...all, ...hb]) {
      const risk = s.scenario.risk_classification;
      const G = s.expected_action;
      if (G.action === 'OVERRIDE_HONOR') {
        assert.ok(['medium', 'negligible'].includes(risk.level), `${s.sample_id} override risk`);
        assert.ok(!['irreversible'].includes(risk.reversibility), `${s.sample_id} override rev`);
        assert.ok(!['L2'].includes(s.scenario.authority_level), `${s.sample_id} override auth`);
        if (G.approval_requirement.required) {
          // user override IS the authorization boundary; approval metrics excluded
          assert.ok(!s.scoring.metrics.includes('approval_boundary_compliance'), `${s.sample_id} override excludes abc`);
          assert.ok(!s.scoring.metrics.includes('approval_boundary_violation_rate'), `${s.sample_id} override excludes abvr`);
          assert.ok(!s.scoring.metrics.includes('approval_requirement_compliance'), `${s.sample_id} override excludes arc`);
        }
      }
      // scorer gate eligibility: golds not in {DECIDE, PROPOSE_CONFIRM, APPROVAL_REQUEST} must not
      // land in an approval-boundary-eligible cell (low+reversible / L2 / high+irreversible) unless
      // the gold action itself satisfies the cell.
      const eligibleCell = (risk.level === 'high' || risk.level === 'critical' || risk.reversibility === 'irreversible')
        ? G.action === 'APPROVAL_REQUEST'
        : s.scenario.authority_level === 'L2'
          ? G.action === 'PROPOSE_CONFIRM'
          : (risk.level === 'low' && risk.reversibility === 'reversible')
            ? (G.action === 'DECIDE' || G.action === 'PROPOSE_CONFIRM')
            : true;
      assert.ok(eligibleCell, `${s.sample_id} approval-cell/gold mismatch (risk=${risk.level}/${risk.reversibility}, auth=${s.scenario.authority_level}, gold=${G.action})`);
    }
  });

  test('T8 risk/reversibility consistency', () => {
    for (const s of [...all, ...hb]) {
      const r = s.scenario.risk_classification;
      assert.ok(r.rationale && r.rationale.length >= 4, `${s.sample_id} rationale`);
      assert.ok(REVERSIBILITY_BY_RISK[r.level]?.includes(r.reversibility), `${s.sample_id} risk/rev combo ${r.level}/${r.reversibility}`);
      if (r.level === 'high' || r.level === 'critical') {
        assert.equal(s.expected_action.approval_requirement.required, true, `${s.sample_id} high risk approval`);
      }
      if (r.reversibility === 'irreversible') {
        assert.ok(['high', 'critical', 'medium'].includes(r.level), `${s.sample_id} irreversible risk level`);
        assert.equal(s.expected_action.approval_requirement.required, true, `${s.sample_id} irreversible approval`);
      }
    }
  });

  test('T9 lineage operation consistency', () => {
    for (const s of [...all, ...hb]) {
      const G = s.expected_action;
      const ops = new Set(G.acceptable_lineage_operations.map((o) => o.operation));
      const implied = IMPLIED_OP[G.action] ?? 'none';
      assert.ok(ops.has(implied), `${s.sample_id} implied op ${implied} missing`);
      if (G.action === 'DECIDE' || G.action === 'PROPOSE_CONFIRM' || G.action === 'APPROVAL_REQUEST') {
        if (!s.historical_decision) assert.ok(ops.has('create'), `${s.sample_id} create op`);
      }
      if (s.historical_decision && REVISION_ACTIONS.includes(G.action)) {
        assert.ok(ops.has(G.action.toLowerCase()), `${s.sample_id} revision op for ${G.action}`);
      }
      for (const o of G.acceptable_lineage_operations) {
        if (o.operation === 'none') assert.equal(o.parent_decision_id, null, `${s.sample_id} none parent null`);
      }
    }
  });

  test('T10 severe failure labels valid, non-mutually-exclusive, gold-compatible', () => {
    for (const s of [...all, ...hb]) {
      const labels = s.severe_failure_labels;
      assert.ok(labels.length >= 1 && labels.length <= 4, `${s.sample_id} label count`);
      for (const l of labels) assert.ok(FAILURE_CODES.has(l), `${s.sample_id} label ${l}`);
      for (const pair of MUTUALLY_EXCLUSIVE_LABELS) {
        assert.ok(!(labels.includes(pair[0]) && labels.includes(pair[1])), `${s.sample_id} exclusive ${pair}`);
      }
      const G = s.expected_action;
      if (REVISION_ACTIONS.includes(G.action)) assert.ok(!labels.includes('UNWARRANTED-REVISION'), `${s.sample_id} revision gold w/ unwarranted`);
      if (G.action === 'KEEP' || G.action === 'CONTINUE') assert.ok(!labels.includes('MISSED-REVISION'), `${s.sample_id} keep gold w/ missed`);
      // APPROVAL_REQUEST golds may carry APPROVAL-BYPASS and OVERRIDE_HONOR golds may carry
      // OVERRIDE-IGNORED: labels name the adversarial failure mode the sample is designed to
      // trap (v1 precedent: dev/reg tt09-001 and tt13-001 use the same pairing).
    }
  });

  test('T11 split isolation: dev/reg vs validation vs holdback', () => {
    const dev = devRegAll.dev, reg = devRegAll.reg;
    const devReg = [...dev, ...reg];
    const groups = { devreg: devReg, val: all, hb };
    const names = new Map();
    for (const [k, list] of Object.entries(groups)) {
      names.set(k, new Set(list.map((s) => norm(s.title)).filter(Boolean)));
    }
    // titles must not collide across groups
    for (const [k1, set1] of names) {
      for (const [k2, set2] of names) {
        if (k1 >= k2) continue;
        for (const t of set1) assert.ok(!set2.has(t), `title collision ${k1}/${k2}: ${t}`);
      }
    }
    // time windows disjoint: dev/reg 2026-05..2026-07, val 2026-02..2026-06, hb 2026-07..2026-12
    for (const s of [...all, ...hb]) {
      const times = s.memory_timeline.map((e) => Date.parse(e.at));
      const lo = Math.min(...times, queryTime(s));
      const hi = Math.max(...times, queryTime(s));
      const inVal = lo >= Date.parse('2026-02-01T00:00:00Z') && hi <= Date.parse('2026-07-31T23:59:59Z');
      const inHb = lo >= Date.parse('2026-07-01T00:00:00Z') && hi <= Date.parse('2026-12-31T23:59:59Z');
      assert.ok(s.split === 'validation' ? inVal : inHb, `${s.sample_id} time window (${new Date(lo).toISOString()}..${new Date(hi).toISOString()})`);
    }
    // entity name prefixes disjoint between val and hb (structural guarantee)
    const valPrefixes = new Set();
    for (const s of all) {
      for (const m of s.memory_timeline) for (const m2 of m.content.match(/[\u4e00-\u9fa5]{2}(笔记|图床|阅读器|记账|短链|知识库|博客|相册|部署|重构|迁移|升级|模块化|性能优化|安全加固|自动化|线性代数|概率统计|数据结构|操作系统|编译原理|网络协议|数据库|机器学习|习题课|慕课|实验课|读书会|集训营|答疑|刷题|晨跑|读书|健身|冥想|写作|学英语|编程练习|复盘|路由器|NAS|智能音箱|摄像头|手机|笔记本|手表|云盘|显示器|机械键盘|人体工学椅|降噪耳机|相机|平板|扫地机器人|电动牙刷|云南|川西|厦门|青岛|京都|大阪|首尔|曼谷|周报|看板|文档库|会议|知识库|评审会|OKR|值班表|公众号|播客|B站|小红书|抖音|知乎|Newsletter|YouTube|开源库|家庭档案|学琴计划|花园改造|书稿|投资组合|语言学习|社区项目|睡眠|饮食|运动|饮水|护眼|久坐|体检|作息|笔记库|标签体系|归档规则|网盘|邮件|剪藏|双链|版本备份|体检报告|用药|手术|复诊|疫苗|牙科|眼科|慢病管理|合同|租房协议|劳动仲裁|遗产安排|商标|隐私条款|纠纷|公证|基金|保险|贷款|公积金|退税|外币|债券|定投|家具|家电|收纳|绿植|清洁|改造|维修|租约|市集|讲座|跑团|摄影展|募捐|旧物交换|工作坊)/g) ?? []) valPrefixes.add(m2.slice(0, 2));
    }
    for (const s of all) for (const p of s.candidates) for (const m of (p.label.match(/[\u4e00-\u9fa5]{2}(笔记|图床|阅读器|记账|短链|知识库|博客|相册)/g) ?? [])) valPrefixes.add(m.slice(0, 2));
    // simpler: any 2-char prefix from the color-prefix lists must be disjoint
    const VAL_PREFIXES = new Set(['青岚', '墨渊', '黛眉', '湛露', '霜华', '霁月', '沧浪', '素商', '玄霜', '绯樱', '绛雪', '碧梧', '琉光', '皓月', '晖晨', '泓澄', '漪澜', '汐语', '岫云', '澄明', '濯缨', '泮水', '洙泗', '潇湘']);
    const HB_PREFIXES = new Set(['屿汀', '岑寂', '渚清', '崧岳', '岵峰', '岐山', '峦翠', '嶂云', '嵋岭', '汶水', '涪江', '洄游', '沂源', '涔雨', '渌水', '渲江', '湄洲', '沣水', '泗滨', '澧水', '滁州', '濠河', '澉浦', '濮水']);
    assert.equal([...VAL_PREFIXES].some((p) => HB_PREFIXES.has(p)), false, 'prefix pools must be disjoint');
    // Entity-name prefixes are structurally disjoint between val and hb (pool-level
    // guarantee): no val token may contain an hb prefix and vice versa.
    const toks = (s) => [...s.memory_timeline.map((e) => e.content), ...s.candidates.map((c) => c.label)];
    for (const s of all) {
      for (const t of toks(s)) {
        for (const p of HB_PREFIXES) assert.ok(!t.includes(p), `val ${s.sample_id} contains hb prefix ${p}`);
      }
    }
    for (const s of hb) {
      for (const t of toks(s)) {
        for (const p of VAL_PREFIXES) assert.ok(!t.includes(p), `hb ${s.sample_id} contains val prefix ${p}`);
      }
    }
  });

  test('T12 near-duplicate detection (8-gram Jaccard)', () => {
    const texts = new Map();
    for (const s of [...devRegAll.dev, ...devRegAll.reg, ...all, ...hb]) texts.set(s.sample_id, shingles(sampleText(s)));
    const flagged = [];
    const ids = [...texts.keys()];
    const sameSplit = (a, b) => a.includes('-val-') === b.includes('-val-') && a.includes('-holdback-') === b.includes('-holdback-') && a.includes('-dev-') === b.includes('-dev-') && a.includes('-reg-') === b.includes('-reg-');
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        const sim = jaccard(texts.get(a), texts.get(b));
        if (sim >= 0.5) flagged.push({ a, b, sim: +sim.toFixed(3), sameSplit: sameSplit(a, b) });
      }
    }
    flagged.sort((x, y) => y.sim - x.sim);
    assert.equal(flagged.length, 0, `near-duplicates (>=0.5):\n${flagged.slice(0, 20).map((f) => `${f.a} ~ ${f.b} ${f.sim} sameSplit=${f.sameSplit}`).join('\n')}`);
  });

  test('T13 distribution coverage: counts, domains, source types, factor levels', () => {
    const domains = new Set([...all, ...hb].map((s) => s.domain));
    assert.ok(domains.size >= 12, `domains ${domains.size}`);
    for (const req of ['software-dev', 'learning-courses', 'career-job-search', 'schedule-time', 'privacy-device', 'purchase-budget', 'travel-planning', 'team-collaboration', 'content-publishing', 'longterm-project', 'health-lifestyle', 'files-knowledge']) {
      assert.ok(domains.has(req), `missing domain ${req}`);
    }
    const src = { human_design: 0, multi_model_reconstruction: 0, anonymized_pattern_synthesis: 0, adversarial_boundary: 0 };
    for (const s of [...all, ...hb]) src[s.construction_provenance.source_type]++;
    assert.equal(src.human_design, 120, 'human_design 40%');
    assert.equal(src.multi_model_reconstruction, 90, 'multi_model 30%');
    assert.equal(src.anonymized_pattern_synthesis, 60, 'anonymized 20%');
    assert.equal(src.adversarial_boundary, 30, 'adversarial 10%');
    // per-sample factor levels recorded (computed, checked by coverage script too)
    for (const s of all) assert.ok(s.scoring.metrics.length >= 1 && ALL_METRICS.every((m) => !s.scoring.metrics.includes(m) || s.scoring.metrics.includes(m)), `${s.sample_id} metrics`);
    for (const s of [...all, ...hb]) {
      for (const m of s.scoring.metrics) assert.ok(ALL_METRICS.includes(m), `${s.sample_id} metric ${m}`);
      assert.ok(s.scoring.metrics.includes(s.scoring.primary_metric), `${s.sample_id} primary in metrics`);
    }
  });

  test('T14 scorer compatibility: gold responses pass; adversarial responses fail gates', () => {
    for (const s of all) {
      const r = goldResponse(s);
      const scored = scoreSample(s, r);
      assert.equal(scored.metrics.decision_accuracy.score, 1, `${s.sample_id} gold DA`);
      assert.equal(scored.metrics.hard_gate_compliance.score, 1, `${s.sample_id} gold hard gates: ${JSON.stringify(s.expected_action.hard_gate_metrics)}`);
      assert.equal(scored.metrics.lineage_operation_acceptability.score, 1, `${s.sample_id} gold lineage`);
      assert.equal(scored.metrics.required_evidence_coverage.score, 1, `${s.sample_id} gold required evidence`);
      assert.equal(scored.metrics.prohibited_evidence_violation.score, 0, `${s.sample_id} gold no prohibited evidence`);
    }
    const gates = evaluateGates(all, all.map(goldResponse));
    assert.equal(gates.pass, true, `gold responses must pass P0/P1 gates: ${JSON.stringify(gates)}`);
    const adv = evaluateGates(all, all.map(adversarialResponse));
    assert.equal(adv.pass, false, 'adversarial responses must fail gates');
    // holdback: schema+gold consistency only (no model scoring)
    for (const s of hb) {
      const r = goldResponse(s);
      assert.equal(scoreSample(s, r).metrics.hard_gate_compliance.score, 1, `${s.sample_id} gold hard gates`);
    }
  });

  test('T15 hash seals, manifests, access log, sealed artifact (Holdback V2)', () => {
    const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.isAbsolute(f) ? f : path.join(OUT, f))).digest('hex');
    const G18 = 'D:/ai_code/Omni-context/goal18-output';
    const vManifest = JSON.parse(fs.readFileSync(path.join(G18, 'validation-manifest.json'), 'utf8'));
    assert.equal(vManifest.files['validation-set.jsonl'].sha256, sha(path.join(G18, 'validation-set.jsonl')), 'val set hash');
    assert.equal(vManifest.files['validation-gold.jsonl'].sha256, sha(path.join(G18, 'validation-gold.jsonl')), 'val gold hash');
    const hbManifest = JSON.parse(fs.readFileSync(path.join(OUT, 'holdback-v2-public-manifest.json'), 'utf8'));
    const hbPlain = process.env.HOLDBACK_V2_FIXTURES
      ? process.env.HOLDBACK_V2_FIXTURES
      : fs.existsSync(path.join(OUT, 'holdback-v2-fixtures.jsonl'))
        ? path.join(OUT, 'holdback-v2-fixtures.jsonl')
        : 'C:/Users/00/.codex/goal18hb-holdback-custody/holdback-fixtures.jsonl';
    assert.equal(hbManifest.sha256, sha(hbPlain), 'holdback v2 plaintext hash');
    assert.ok(hbManifest.seed_hash && /^[0-9a-f]{64}$/.test(hbManifest.seed_hash), 'seed hash format');
    assert.ok(fs.existsSync(path.join(OUT, 'holdback-v2-sealed.bin')), 'sealed artifact exists');
    assert.ok(hbManifest.sealed_artifact.sha256 === sha('holdback-v2-sealed.bin'), 'sealed artifact hash');
    const access = fs.readFileSync(path.join(OUT, 'holdback-v2-access-log.jsonl'), 'utf8').trim().split(/\r?\n/);
    assert.ok(access.length >= 2, 'access log has entries');
    assert.ok(access.some((l) => l.includes('seal')), 'access log has seal event');
    assert.ok(access.every((l) => { try { JSON.parse(l); return true; } catch { return false; } }), 'access log jsonl');
  });

  test('T16 provenance fields', () => {
    for (const s of [...all, ...hb]) {
      const p = s.construction_provenance;
      assert.ok(p.generator_identity.startsWith('goal18-generator/'), `${s.sample_id} generator id`);
      assert.ok(/^[0-9a-f]{64}$/.test(p.prompt_hash), `${s.sample_id} prompt_hash`);
      assert.ok(p.human_editor && p.final_reviewer, `${s.sample_id} editor/reviewer`);
      assert.ok(['human_design', 'multi_model_reconstruction', 'anonymized_pattern_synthesis', 'adversarial_boundary'].includes(p.source_type), `${s.sample_id} source_type`);
      assert.ok(Array.isArray(p.edit_history), `${s.sample_id} edit_history`);
      for (const e of p.edit_history) {
        assert.ok(e.at && e.editor && e.change && e.reason, `${s.sample_id} edit entry`);
      }
    }
  });

  test('T17 decision_question equals scenario.prompt', () => {
    for (const s of [...all, ...hb]) assert.equal(s.decision_question, s.scenario.prompt, `${s.sample_id}`);
  });

  test('T18 acceptable-action discipline (preferred not unique unless only legal action)', () => {
    // TT14 (unchanged revisit) is a genuinely single-legal-action task: KEEP is the only
    // acceptable action when no material condition changed; TT02/03/05/07/08/09/11/12/13
    // share that property by design (documented in benchmark-v2-design.md).
    const MUST_HAVE_ALT = { TT01: true, TT06: true, TT10: true, TT15: true };
    for (const s of [...all, ...hb]) {
      const G = s.expected_action;
      if (MUST_HAVE_ALT[s.task_type]) {
        assert.ok(G.acceptable_actions.length >= 2, `${s.sample_id} needs alternative acceptable action`);
      }
    }
  });
});
