// v2 fixtures loader: validation set + gold join + holdback.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Validation/dev/reg/schema are the frozen Goal 18 artifacts; Holdback V2 plaintext is loaded separately (see loadHoldbackFull).
export const GOAL18_DIR = 'D:/ai_code/Omni-context/goal18-output';

export function loadJsonl(relPath) {
  const raw = fs.readFileSync(path.join(GOAL18_DIR, relPath), 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    try { return JSON.parse(line); }
    catch (e) { throw new Error(`Bad JSON at ${relPath}:${i + 1}: ${e.message}`); }
  });
}

export function loadSchema(relPath) {
  return JSON.parse(fs.readFileSync(path.join(GOAL18_DIR, relPath), 'utf8').replace(/^\uFEFF/, ''));
}

export function loadValidation() {
  const set = loadJsonl('validation-set.jsonl');
  const gold = loadJsonl('validation-gold.jsonl');
  const byId = new Map(gold.map((g) => [g.sample_id, g]));
  const joined = set.map((s) => {
    const g = byId.get(s.sample_id);
    if (!g) throw new Error(`missing gold for ${s.sample_id}`);
    return { ...s, ...g };
  });
  return { set, gold, all: joined };
}

export function loadHoldbackFull() {
  // Holdback V2 (Goal 18HB): plaintext lives only in the offline custody dir (or an explicit
  // env path during pre-seal auditing). Never read the V1 custody dir.
  const explicit = process.env.HOLDBACK_V2_FIXTURES;
  const repoPath = path.join(path.resolve(here, '..'), 'holdback-v2-fixtures.jsonl');
  const candidates = [explicit, repoPath, 'C:/Users/00/.codex/goal18hb-holdback-custody/holdback-fixtures.jsonl'].filter(Boolean);
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('holdback fixtures unavailable: repo plaintext sealed and custody copy not found');
  const raw = fs.readFileSync(found, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    try { return JSON.parse(line); }
    catch (e) { throw new Error('Bad JSON at ' + found + ':' + (i + 1) + ': ' + e.message); }
  });
}

export const TASK_TYPES = ['TT01', 'TT02', 'TT03', 'TT04', 'TT05', 'TT06', 'TT07', 'TT08', 'TT09', 'TT10', 'TT11', 'TT12', 'TT13', 'TT14', 'TT15'];
export const ACTIONS = ['DECIDE', 'CLARIFY', 'DEFER', 'REJECT', 'PROPOSE_CONFIRM', 'KEEP', 'CONTINUE', 'REVISE', 'REVERSE', 'INVALIDATE', 'SUPERSEDE', 'APPROVAL_REQUEST', 'OVERRIDE_HONOR'];
export const ALL_METRICS = [
  'decision_accuracy', 'hard_constraint_violation_rate', 'warranted_decisiveness',
  'unnecessary_abstention_rate', 'clarification_efficiency', 'evidence_support_rate',
  'temporal_validity_rate', 'revision_precision', 'revision_recall',
  'decision_stability', 'outcome_adaptation', 'approval_boundary_compliance',
  'actionability', 'explanation_traceability',
  'correct_refusal_rate', 'over_questioning_rate', 'missed_revision_rate',
  'unwarranted_flapping_rate', 'clear_correct_rate', 'arbitrary_decisiveness_rate',
  'clarification_permissibility', 'approval_requirement_compliance', 'mandatory_constraints_honored',
  'lineage_operation_acceptability', 'approval_boundary_violation_rate', 'unsupported_decision_rate',
  'invalid_revision_rate', 'temporal_invalid_evidence_use_rate', 'user_override_violation_rate'
];

export function queryTime(sample) { return Date.parse(sample.scenario.query_time); }

export function allIds(sample) {
  const ids = new Set(sample.memory_timeline.map((e) => e.event_id));
  sample.candidates.forEach((c) => ids.add(c.id));
  sample.hard_constraints.forEach((h) => ids.add(h.id));
  sample.soft_preferences.forEach((p) => ids.add(p.id));
  sample.evidence.qualified.forEach((e) => ids.add(e.id));
  sample.evidence.expired.forEach((e) => ids.add(e.id));
  sample.evidence.conflicting.forEach((e) => ids.add(e.id));
  if (sample.historical_decision) ids.add(sample.historical_decision.decision_id);
  return ids;
}
