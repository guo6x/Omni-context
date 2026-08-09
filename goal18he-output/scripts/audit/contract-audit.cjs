const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// Goal 18H-E contract audit engine.
// Frozen-contract grounded checks over Validation fixture+gold.
// Usage: node contract-audit.cjs --data <dir with validation-set.jsonl+validation-gold.jsonl> --out <output dir>
// ============================================================================

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      args[k] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
      if (typeof args[k] !== 'boolean') i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const DATA_DIR = args.data || 'D:/ai_code/Omni-context/goal18-output';
const OUT_DIR = args.out || 'D:/ai_code/Omni-context/goal18he-output';
const SET_FILE = args.setFile || 'validation-set.jsonl';
const GOLD_FILE = args.goldFile || 'validation-gold.jsonl';

const setLines = fs.readFileSync(path.join(DATA_DIR, SET_FILE), 'utf8').trim().split('\n').map((l, i) => {
  try { return JSON.parse(l); } catch (e) { throw new Error(`set line ${i + 1}: ${e.message}`); }
});
const goldLines = fs.readFileSync(path.join(DATA_DIR, GOLD_FILE), 'utf8').trim().split('\n').map((l, i) => {
  try { return JSON.parse(l); } catch (e) { throw new Error(`gold line ${i + 1}: ${e.message}`); }
});
const goldById = new Map(goldLines.map(g => [g.sample_id, g]));
const all = setLines.map(s => {
  const g = goldById.get(s.sample_id);
  if (!g) throw new Error(`missing gold ${s.sample_id}`);
  return { fixture: s, gold: g, joined: { ...s, expected_action: g.expected_action } };
});

const EXEC_ACTIONS = ['DECIDE', 'CONTINUE', 'REVISE', 'REVERSE', 'INVALIDATE', 'SUPERSEDE'];
const IMPLIED_OP = { DECIDE: 'create', PROPOSE_CONFIRM: 'create', APPROVAL_REQUEST: 'create', CONTINUE: 'continue', REVISE: 'revise', REVERSE: 'reverse', INVALIDATE: 'invalidate', SUPERSEDE: 'supersede' };

function queryTime(s) { return Date.parse(s.scenario.query_time); }
function deletedSources(s) { return s.memory_timeline.filter(e => e.type === 'delete').flatMap(e => e.targets ?? []); }
function eventById(s, id) { return s.memory_timeline.find(e => e.event_id === id); }

// ---------------- dimension: authority/action (RI-05) ----------------
function authorityAction(row) {
  const s = row.fixture, G = row.gold.expected_action;
  const a = s.scenario.authority_level, act = G.action;
  const problems = [];
  if (['L0', 'L1'].includes(a) && EXEC_ACTIONS.includes(act)) {
    problems.push(`authority ${a} does not grant AI decision/action right; DECIDE gate requires "authority allows" (K:195; A decision_right ${a}=user; A can_decide=${a}=false)`);
  }
  if (a === 'L2' && (act === 'DECIDE' || act === 'CONTINUE' || EXEC_ACTIONS.includes(act))) {
    problems.push(`L2 requires PROPOSE_CONFIRM (user confirmation gate) before any action; autonomous ${act} is not allowed (A L2 approval_gate; P L2-CONFIRM-BEFORE-ACTION)`);
  }
  if (act === 'PROPOSE_CONFIRM' && a !== 'L2') {
    problems.push(`PROPOSE_CONFIRM is the L2 confirmation-gate action; authority ${a} does not map to it (S approval_boundary rule; F6)`);
  }
  if (['L0', 'L1'].includes(a) && (G.acceptable_actions.includes('DECIDE') || G.acceptable_actions.includes('CONTINUE'))) {
    problems.push(`acceptable_actions include executive action under ${a} (complete full-credit set must be authority-compatible)`);
  }
  return { status: problems.length ? 'FAIL' : 'PASS', problems };
}

// ---------------- dimension: action eligibility ----------------
function actionEligibility(row) {
  const s = row.fixture, G = row.gold.expected_action;
  const act = G.action;
  const probs = [];
  const feas = s.candidates.filter(c => !c.violates_hard_constraint);
  const openKey = s.evidence.conflicting.filter(c => c.status === 'open' && c.key_variable);
  const missingKey = s.evidence.qualified.filter(e => /未定|尚未确定|待确认|未知/.test(e.fact));
  const afterMade = (() => {
    const hd = s.historical_decision;
    if (!hd) return [];
    const t = Date.parse(hd.made_at ?? hd.madeAt ?? hd.created_at ?? '');
    return s.evidence.qualified.filter(e => Number.isFinite(t) && Date.parse(e.at) > t && (e.confidence ?? 0) >= 0.6);
  })();
  const changeEvents = (() => {
    const hd = s.historical_decision;
    if (!hd) return [];
    const t = Date.parse(hd.made_at ?? hd.madeAt ?? hd.created_at ?? '');
    return s.memory_timeline.filter(e => Number.isFinite(t) && Date.parse(e.at) > t && ['update', 'delete', 'decision'].includes(e.type));
  })();
  const overrideEvents = s.memory_timeline.filter(e => e.type === 'override' && (e.writer?.type ?? '') === 'user');
  const risk = s.scenario.risk_classification;

  switch (act) {
    case 'DECIDE':
      if (feas.length === 0) probs.push('DECIDE requires >=1 feasible option (K:195)');
      if (openKey.length) probs.push('DECIDE requires sufficiency gate pass; open key-variable conflict present (K:195; P evidence_sufficiency_gate)');
      if (missingKey.length) probs.push('DECIDE requires sufficiency gate pass; missing key variable evidence present (K:195)');
      if (['L0', 'L1'].includes(s.scenario.authority_level)) probs.push('DECIDE requires authority allows (K:195; L0/L1 decision_right=user)');
      if (s.scenario.authority_level === 'L2') probs.push('L2 cannot DECIDE without confirmation (A L2; P L2-CONFIRM-BEFORE-ACTION)');
      break;
    case 'CLARIFY':
      if (!G.key_question) probs.push('CLARIFY gold requires exactly one key_question (GOLD-C8)');
      if (!openKey.length && !missingKey.length) probs.push('CLARIFY requires decision-blocking insufficiency (open key conflict or missing key variable) (K:196; P evidence_sufficiency_gate)');
      break;
    case 'REJECT':
      if (!G.coded_reason) probs.push('REJECT requires coded reason (M1; P REJECT-REASONS)');
      if (G.coded_reason === 'no_feasible_option' && feas.length > 0) probs.push('REJECT no_feasible_option requires zero feasible options');
      break;
    case 'PROPOSE_CONFIRM':
      if (s.scenario.authority_level !== 'L2') probs.push('PROPOSE_CONFIRM is the L2 confirmation-gate action (S boundary rule; A L2)');
      if (risk.level !== 'low' || risk.reversibility !== 'reversible') probs.push('L2 confirmation gate scope is low risk + reversible (A risk_scope_by_level.L2; P L2-CONFIRM-BEFORE-ACTION)');
      break;
    case 'KEEP':
      if (!s.historical_decision) probs.push('KEEP requires an existing decision to keep (REVISION-INERTIA)');
      if (s.historical_decision) {
        const snap = s.historical_decision.snapshot ?? [];
        const currentOpt = snap.flatMap(id => s.evidence.qualified.find(e => e.id === id)?.supports ?? [])[0];
        if (afterMade.some(e => e.supports?.length && currentOpt && e.supports.some(o => o !== currentOpt))) probs.push('KEEP requires no sufficient new evidence changing ranking (REVISION-INERTIA)');
      }
      if (changeEvents.length) probs.push('KEEP requires no key-condition change/update event (REVISION-INERTIA)');
      break;
    case 'CONTINUE':
      if (!s.historical_decision) probs.push('CONTINUE requires an existing decision (continues chain) (K:1/L PARENT-RULE)');
      if (!s.execution_outcome || s.execution_outcome.status !== 'success') probs.push('CONTINUE requires verified successful outcome (TT11 pattern: chain continuity, no contradiction)');
      if (changeEvents.length) probs.push('CONTINUE requires no contradiction/change (L PARENT-RULE)');
      break;
    case 'REVISE':
    case 'REVERSE':
      if (!s.historical_decision) probs.push(`${act} requires a historical decision target (K:15; GOLD-C11)`);
      if (!afterMade.length) probs.push(`${act} requires sufficient new evidence / key-condition change after the old decision (K:15 REVISE/REVERSE triggers)`);
      break;
    case 'INVALIDATE':
      if (!s.historical_decision) probs.push('INVALIDATE requires a historical decision target (K:15)');
      if (!deletedSources(s).length && !s.evidence.expired.filter(e => e.expiry_reason === 'source_deleted').length) probs.push('INVALIDATE requires key condition/assumption no longer holds (delete/source_deleted signal) (K:15; P INVALIDATE-ON-CONDITION-LOSS)');
      break;
    case 'APPROVAL_REQUEST':
      if (!(risk.level === 'high' || risk.level === 'critical' || risk.reversibility === 'irreversible')) probs.push('APPROVAL_REQUEST trigger requires risk>=high OR irreversible (K:11 HIGH-RISK-APPROVAL)');
      break;
    case 'OVERRIDE_HONOR':
      if (!overrideEvents.length) probs.push('OVERRIDE_HONOR requires an explicit user override/revoke event (P OVERRIDE-ALWAYS; A resolution.user_override)');
      break;
    case 'DEFER':
      if (!s.memory_timeline.some(e => /暂缓|等待|推迟/.test(e.content))) probs.push('DEFER requires external timing/user request or not-yet-relevant info (K:197)');
      break;
    default:
      break;
  }
  return { status: probs.length ? 'FAIL' : 'PASS', problems: probs };
}

// ---------------- dimension: approval / confirmation ----------------
function approvalConfirmation(row) {
  const s = row.fixture, G = row.gold.expected_action;
  const risk = s.scenario.risk_classification;
  const required = risk.level === 'high' || risk.level === 'critical' || risk.reversibility === 'irreversible';
  const problems = [];
  if (G.approval_requirement.required !== required) problems.push(`required ${G.approval_requirement.required} != frozen rule ${required} (risk high/critical OR irreversible) (G:150 GOLD-C10; B:926)`);
  let gate;
  if (required) gate = 'approval';
  else if (s.scenario.authority_level === 'L2') gate = 'propose_confirm';
  else gate = 'none';
  if (G.approval_requirement.gate !== gate) problems.push(`gate ${G.approval_requirement.gate} != frozen rule ${gate} (G:150; B:935)`);
  if (!G.approval_requirement.reason || G.approval_requirement.reason.length < 4) problems.push('approval reason missing/short (schema minLength 4)');
  return { status: problems.length ? 'FAIL' : 'PASS', problems };
}

// ---------------- dimension: lineage ----------------
function lineage(row) {
  const s = row.fixture, G = row.gold.expected_action;
  const act = G.action;
  const implied = IMPLIED_OP[act] ?? 'none';
  const ops = G.acceptable_lineage_operations;
  const problems = [];
  if (!ops || !ops.length) problems.push('acceptable_lineage_operations empty (GOLD-C11)');
  if (!ops.some(o => o.operation === implied)) problems.push(`implied lineage ${implied} not in acceptable ops (scorer v1.1 impliedOp; GOLD-C11)`);
  const hd = s.historical_decision;
  if (['revise', 'reverse', 'invalidate', 'supersede', 'continue'].includes(implied)) {
    if (!hd) problems.push(`${implied} requires historical decision parent (G:182; B:974)`);
    else if (!ops.some(o => o.operation === implied && o.parent_decision_id === hd.decision_id)) problems.push(`${implied} parent must equal historical_decision.decision_id (B:974; GOLD-C11)`);
  }
  if (implied === 'create' && hd) {
    // create with existing history is contractually odd; gold must then carry the historical parent explicitly (continue/revision). Flag only when no parent link.
    if (!ops.some(o => o.operation === 'create' && o.parent_decision_id === hd.decision_id)) problems.push('create under existing historical decision without linking parent (K:15; G:182)');
  }
  if (implied === 'none' && !ops.some(o => o.operation === 'none' && o.parent_decision_id === null)) problems.push('none requires null parent (GOLD-C11; G:182)');
  for (const o of ops) {
    if (o.operation === 'none' && o.parent_decision_id !== null) problems.push('none op with non-null parent (GOLD-C11)');
  }
  return { status: problems.length ? 'FAIL' : 'PASS', problems };
}

// ---------------- dimension: evidence ----------------
function evidence(row) {
  const s = row.fixture, G = row.gold.expected_action;
  const qIds = new Set(s.evidence.qualified.map(e => e.id));
  const exIds = new Set(s.evidence.expired.map(e => e.id));
  const del = new Set(deletedSources(s));
  const qt = queryTime(s);
  const problems = [];
  if (!G.required_evidence.length) problems.push('required_evidence empty (GOLD-C4 minItems 1)');
  for (const id of G.required_evidence) if (!qIds.has(id)) problems.push(`required ${id} not qualified (GOLD-C4)`);
  for (const id of G.required_evidence) if (G.prohibited_evidence.includes(id)) problems.push(`required∩prohibited ${id} (GOLD-C6)`);
  for (const id of G.prohibited_evidence) if (!exIds.has(id)) problems.push(`prohibited ${id} not expired (GOLD-C5)`);
  for (const ev of [...s.evidence.qualified, ...s.evidence.expired, ...s.evidence.conflicting]) {
    if (ev.source_ref && !eventById(s, ev.source_ref)) problems.push(`${ev.id}.source_ref ${ev.source_ref} missing (RI-03)`);
  }
  for (const ev of s.evidence.qualified) if (Date.parse(ev.at) > qt) problems.push(`${ev.id} after query_time (T5)`);
  for (const ex of s.evidence.expired) if (Date.parse(ex.valid_until) >= qt) problems.push(`${ex.id} valid_until >= query_time (T5)`);
  for (const ev of s.evidence.qualified) if (del.has(ev.source_ref)) problems.push(`qualified ${ev.id} sources deleted event ${ev.source_ref} (RI-06)`);
  for (const d of del) {
    const srcDel = s.evidence.expired.filter(e => e.source_ref === d && e.expiry_reason === 'source_deleted');
    if (!srcDel.length) problems.push(`deleted source ${d} lacks source_deleted expired artifact (T5)`);
  }
  for (const c of s.candidates) for (const ref of c.evidence_refs ?? []) if (!qIds.has(ref) && !exIds.has(ref)) problems.push(`candidate ${c.id} evidence_ref ${ref} unresolved (RI-03)`);
  return { status: problems.length ? 'FAIL' : 'PASS', problems };
}

// ---------------- dimension: constraints ----------------
function constraints(row) {
  const s = row.fixture, G = row.gold.expected_action;
  const hs = s.hard_constraints.map(h => h.id).sort();
  const ms = [...G.mandatory_constraints].sort();
  const problems = [];
  if (JSON.stringify(hs) !== JSON.stringify(ms)) problems.push(`mandatory_constraints != hard_constraints ids (GOLD-C7)`);
  return { status: problems.length ? 'FAIL' : 'PASS', problems };
}

// ---------------- dimension: clarification ----------------
function clarification(row) {
  const s = row.fixture, G = row.gold.expected_action;
  const probs = [];
  if (G.action === 'CLARIFY') {
    if (!G.key_question) probs.push('CLARIFY gold missing key_question (GOLD-C8)');
    else {
      if (JSON.stringify([...G.permissible_clarifications].sort()) !== JSON.stringify([G.key_question.variable].sort())) probs.push(`permissible != [key_question.variable] (GOLD-C8)`);
      const distractors = s.scenario.distractor_variables ?? [];
      if (JSON.stringify([...G.forbidden_clarifications].sort()) !== JSON.stringify([...distractors].sort())) probs.push(`forbidden != scenario.distractor_variables (GOLD-C9)`);
      const openKey = s.evidence.conflicting.some(c => c.status === 'open' && c.key_variable);
      const missingKey = s.evidence.qualified.some(e => /未定|尚未确定|待确认|未知/.test(e.fact));
      if (!openKey && !missingKey) probs.push('no decision-blocking insufficiency signal (K:196; P evidence_sufficiency_gate)');
    }
  } else {
    if (G.permissible_clarifications.length) probs.push(`non-CLARIFY with permissible_clarifications (GOLD-C8b)`);
    if (G.key_question !== null && G.key_question !== undefined) probs.push(`non-CLARIFY with key_question (GOLD-C8b)`);
  }
  if (G.permissible_clarifications.some(v => G.forbidden_clarifications.includes(v))) probs.push('permissible ∩ forbidden non-empty (GOLD-C9)');
  return { status: probs.length ? 'FAIL' : 'PASS', problems: probs };
}

// ---------------- dimension: deleted-source provenance ----------------
function deletedSource(row) {
  const s = row.fixture;
  const del = deletedSources(s);
  const problems = [];
  for (const d of del) {
    const qualifiedRefs = s.evidence.qualified.filter(e => e.source_ref === d);
    if (qualifiedRefs.length) problems.push(`qualified evidence ${qualifiedRefs.map(e => e.id).join(',')} references deleted source ${d} (RI-06; prohibited source not current)`);
    const srcDel = s.evidence.expired.filter(e => e.source_ref === d && e.expiry_reason === 'source_deleted');
    if (!srcDel.length) problems.push(`deleted source ${d} has no source_deleted expired artifact`);
    for (const ex of srcDel) if (Date.parse(ex.at) >= Date.parse(ex.valid_until)) problems.push(`${ex.id} invalid interval`);
  }
  // required_evidence must not reference any deleted source transitively
  return { status: problems.length ? 'FAIL' : 'PASS', problems };
}

// ---------------- referential integrity (audit-local RI-01..08) ----------------
function referential(row) {
  const s = row.fixture;
  const probs = [];
  const ids = new Set();
  s.memory_timeline.forEach(e => ids.add(e.event_id));
  s.candidates.forEach(c => ids.add(c.id));
  s.hard_constraints.forEach(h => ids.add(h.id));
  s.soft_preferences.forEach(p => ids.add(p.id));
  s.evidence.qualified.forEach(e => ids.add(e.id));
  s.evidence.expired.forEach(e => ids.add(e.id));
  s.evidence.conflicting.forEach(e => ids.add(e.id));
  if (s.historical_decision) ids.add(s.historical_decision.decision_id);
  const dup = [...ids].filter((x, i) => [...ids].indexOf(x) !== i);
  if (dup.length) probs.push(`duplicate ids ${dup.join(',')} (RI-01)`);
  for (const e of s.memory_timeline) {
    for (const t of e.targets ?? []) if (!ids.has(t)) probs.push(`event ${e.event_id} target ${t} unresolved (RI-02)`);
    for (const d of e.derivedFrom ?? []) if (!ids.has(d)) probs.push(`event ${e.event_id} derivedFrom ${d} unresolved (RI-02)`);
    if (e.supersedes && !ids.has(e.supersedes)) probs.push(`event ${e.event_id} supersedes ${e.supersedes} unresolved (RI-02)`);
  }
  for (const h of s.hard_constraints) if (h.source_ref && !ids.has(h.source_ref)) probs.push(`hc ${h.id} source_ref unresolved (RI-03)`);
  for (const p of s.soft_preferences) if (p.source_ref && !ids.has(p.source_ref)) probs.push(`sp ${p.id} source_ref unresolved (RI-03)`);
  if (s.goal?.source_ref && !ids.has(s.goal.source_ref)) probs.push(`goal.source_ref unresolved (RI-03)`);
  return { status: probs.length ? 'FAIL' : 'PASS', problems: probs };
}

// ---------------- run all ----------------
const rows = all.map(row => {
  const dims = {
    authority_action: authorityAction(row),
    action_eligibility: actionEligibility(row),
    approval_confirmation: approvalConfirmation(row),
    lineage: lineage(row),
    evidence: evidence(row),
    constraints: constraints(row),
    clarification: clarification(row),
    deleted_source_provenance: deletedSource(row),
    referential_integrity: referential(row)
  };
  return { sample_id: row.fixture.sample_id, task_type: row.fixture.task_type, authority: row.fixture.scenario.authority_level, risk: row.fixture.scenario.risk_classification.level, reversibility: row.fixture.scenario.risk_classification.reversibility, gold_action: row.gold.expected_action.action, approval_required: row.gold.expected_action.approval_requirement.required, approval_gate: row.gold.expected_action.approval_requirement.gate, dims };
});

function statusCounts(rows, dim) {
  const c = { PASS: 0, FAIL: 0, AMBIGUOUS: 0 };
  for (const r of rows) c[r.dims[dim].status]++;
  return c;
}

// ---- CSVs ----
function csvEscape(v) { return /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v); }
function writeCsv(name, header, bodyRows) {
  const content = [header.join(','), ...bodyRows.map(r => r.map(csvEscape).join(','))].join('\n') + '\n';
  fs.writeFileSync(path.join(OUT_DIR, name), content, 'utf8');
}

const dimFiles = {
  authority_action: { file: 'authority-action-audit.csv', header: ['sample_id', 'task_type', 'authority', 'gold_action', 'status', 'detail', 'contract_ref'] },
  deleted_source_provenance: { file: 'deleted-source-provenance-audit.csv', header: ['sample_id', 'task_type', 'status', 'detail', 'contract_ref'] },
  action_eligibility: { file: 'validation-action-eligibility-audit.csv', header: ['sample_id', 'task_type', 'gold_action', 'status', 'detail', 'contract_ref'] },
  approval_confirmation: { file: 'validation-approval-confirmation-audit.csv', header: ['sample_id', 'task_type', 'authority', 'risk', 'reversibility', 'required', 'gate', 'status', 'detail', 'contract_ref'] },
  lineage: { file: 'validation-lineage-audit.csv', header: ['sample_id', 'task_type', 'gold_action', 'implied_op', 'status', 'detail', 'contract_ref'] },
  evidence: { file: 'validation-evidence-audit.csv', header: ['sample_id', 'task_type', 'status', 'detail', 'contract_ref'] },
  constraints: { file: 'validation-constraint-audit.csv', header: ['sample_id', 'task_type', 'status', 'detail', 'contract_ref'] },
  clarification: { file: 'validation-clarification-audit.csv', header: ['sample_id', 'task_type', 'gold_action', 'status', 'detail', 'contract_ref'] }
};
const CONTRACT_REFS = {
  authority_action: 'K:195; A decision_right/action_right; F6; P L2-CONFIRM-BEFORE-ACTION',
  deleted_source_provenance: 'RI-06; G:94-99; T5; P INVALIDATE-ON-CONDITION-LOSS',
  action_eligibility: 'K:7/K:15; GOLD-C8; P REJECT-REASONS / REVISION-INERTIA / HIGH-RISK-APPROVAL / OVERRIDE-ALWAYS',
  approval_confirmation: 'G:150 GOLD-C10; B:926/935; S approval_boundary rule',
  lineage: 'G:182 GOLD-C11; B:947-979; scorer v1.1 impliedOp',
  evidence: 'GOLD-C4/C5/C6; T5; B:877/884',
  constraints: 'GOLD-C7; B:894-900',
  clarification: 'GOLD-C8/C9; K:196; P evidence_sufficiency_gate'
};
for (const [dim, spec] of Object.entries(dimFiles)) {
  const body = rows.map(r => {
    const d = r.dims[dim];
    const extras = {
      authority_action: [r.authority, r.gold_action],
      action_eligibility: [r.gold_action],
      approval_confirmation: [r.authority, r.risk, r.reversibility, r.approval_required, r.approval_gate],
      lineage: [r.gold_action, IMPLIED_OP[r.gold_action] ?? 'none'],
      clarification: [r.gold_action]
    }[dim] ?? [];
    return [r.sample_id, r.task_type, ...extras, d.status, d.problems.join(' | ') || 'ok', CONTRACT_REFS[dim]];
  });
  writeCsv(spec.file, spec.header, body);
}

// master validation-120-contract-audit.csv
{
  const header = ['sample_id', 'task_type', 'authority', 'risk', 'gold_action', 'authority_action', 'action_eligibility', 'approval_confirmation', 'lineage', 'evidence', 'constraints', 'clarification', 'deleted_source_provenance', 'referential_integrity', 'overall', 'details'];
  const body = rows.map(r => {
    const ds = r.dims;
    const overall = Object.values(ds).some(d => d.status === 'FAIL') ? 'FAIL' : 'PASS';
    const details = Object.entries(ds).filter(([, d]) => d.status !== 'PASS').map(([k, d]) => `${k}: ${d.problems.join('; ')}`).join(' || ');
    return [r.sample_id, r.task_type, r.authority, r.risk, r.gold_action,
      ds.authority_action.status, ds.action_eligibility.status, ds.approval_confirmation.status,
      ds.lineage.status, ds.evidence.status, ds.constraints.status, ds.clarification.status,
      ds.deleted_source_provenance.status, ds.referential_integrity.status, overall, details || 'ok'];
  });
  writeCsv('validation-120-contract-audit.csv', header, body);
}

function rowRisk(r) { return r.fixture.scenario.risk_classification.reversibility; }

// master JSON
{
  const summary = {};
  for (const dim of Object.keys(dimFiles)) summary[dim] = statusCounts(rows, dim);
  summary.referential_integrity = statusCounts(rows, 'referential_integrity');
  const master = {
    schema_version: 'validation-120-contract-audit-v1',
    goal: '18H-E',
    dataset: DATA_DIR,
    generated_at: new Date().toISOString(),
    counts: { total: rows.length, task_types: 15, per_task_type: 8 },
    summary,
    overall_status: rows.every(r => Object.values(r.dims).every(d => d.status === 'PASS')) ? 'PASS' : 'FAIL',
    per_sample: rows.map(r => ({ sample_id: r.sample_id, task_type: r.task_type, authority: r.authority, risk: r.risk, gold_action: r.gold_action, dimensions: Object.fromEntries(Object.entries(r.dims).map(([k, d]) => [k, { status: d.status, details: d.problems }])) }))
  };
  fs.writeFileSync(path.join(OUT_DIR, 'validation-120-contract-audit.json'), JSON.stringify(master, null, 2) + '\n', 'utf8');

  // markdown
  const lines = [`# Validation 120 Contract Audit (${path.basename(DATA_DIR)})`, '', `**Overall:** ${master.overall_status} · **Samples:** ${master.counts.total} (15 task types × 8)`, ''];
  lines.push('| Dimension | PASS | FAIL | AMBIGUOUS |', '|---|---|---|---|');
  for (const [dim, c] of Object.entries(master.summary)) lines.push(`| ${dim} | ${c.PASS} | ${c.FAIL} | ${c.AMBIGUOUS} |`);
  lines.push('', '## Failing samples', '');
  const fails = rows.filter(r => master.per_sample.find(p => p.sample_id === r.sample_id).dimensions && Object.values(master.per_sample.find(p => p.sample_id === r.sample_id).dimensions).some(d => d.status !== 'PASS'));
  if (!fails.length) lines.push('None.');
  else for (const f of fails) {
    const p = master.per_sample.find(x => x.sample_id === f.sample_id);
    lines.push(`### ${f.sample_id}`);
    for (const [k, d] of Object.entries(p.dimensions)) if (d.status !== 'PASS') lines.push(`- **${k}:** ${d.status} — ${d.details.join('; ')}`);
  }
  lines.push('', '## Method', '', 'Every dimension is derived from the frozen runtime/gold contracts (K section 7/15, A authority model, P policy rules, G/B gold contract, scorer v1.1 semantics). No dimension is inferred from Gold alone or from HR1 answers.');
  fs.writeFileSync(path.join(OUT_DIR, 'validation-120-contract-audit.md'), lines.join('\n') + '\n', 'utf8');
  console.log(JSON.stringify(master.summary, null, 2));
  console.log('overall', master.overall_status);
}
