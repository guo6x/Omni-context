/**
 * Field-level validator for decision-benchmark-v1 samples.
 * Mirrors decision-benchmark-schema.json plus the semantic rules from
 * decision-benchmark-v1.md §7 (timeline consistency, expected-action legality).
 */

import { readFileSync } from 'node:fs';

export const SCHEMA_VERSION = 'decision-benchmark-v1';

export const TASK_TYPES = Object.freeze(Array.from({ length: 15 }, (_, i) => i + 1));

export const ACTIONS = Object.freeze(['decide', 'clarify', 'persist', 'revise', 'flag_review', 'accept_override']);

export const TIMELINE_KINDS = Object.freeze([
  'goal', 'candidate', 'hard_constraint', 'soft_preference',
  'evidence', 'evidence_expired', 'evidence_conflict', 'evidence_deleted',
  'decision', 'decision_revision', 'outcome', 'agent_advice',
  'user_override', 'revisit_due',
]);

export const SEVERE_LABELS = Object.freeze([
  'hard_constraint_violation', 'unsupported_reversal', 'missed_expiry',
  'missed_conflict', 'unwarranted_abstention', 'unnecessary_clarification',
  'missed_revision', 'flip_flop', 'arbitrary_decision', 'ignored_override',
  'missed_revisit', 'missed_invalidation_propagation', 'none',
]);

// Legal expected actions per task type (from decision-benchmark-v1.md §3).
export const LEGAL_ACTIONS_BY_TYPE = Object.freeze({
  1: ['decide'],
  2: ['clarify'],
  3: ['decide'],
  4: ['decide', 'persist'],
  5: ['decide', 'clarify'],
  6: ['revise'],
  7: ['persist'],
  8: ['decide'],
  9: ['decide', 'clarify'],
  10: ['revise'],
  11: ['persist'],
  12: ['decide', 'clarify'],
  13: ['accept_override'],
  14: ['flag_review'],
  15: ['flag_review'],
});

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

export function validateSample(sample, { index = null } = {}) {
  const errors = [];
  const where = index === null ? '' : `[line ${index}] `;
  const fail = (msg) => errors.push(`${where}${msg}`);

  if (!sample || typeof sample !== 'object') {
    return [`${where}not an object`];
  }
  const knownKeys = new Set([
    'schema_version', 'sample_id', 'task_type', 'title', 'narrative',
    'memory_timeline', 'goal', 'candidates', 'hard_constraints',
    'soft_preferences', 'valid_evidence', 'expired_evidence',
    'conflicting_evidence', 'historical_decisions', 'execution_results',
    'expected_decision_action', 'expected_action_detail',
    'acceptable_explanation', 'severe_failure_label', 'tags',
  ]);
  for (const key of Object.keys(sample)) {
    if (!knownKeys.has(key)) fail(`unknown key: ${key}`);
  }
  if (sample.schema_version !== SCHEMA_VERSION) fail(`schema_version must be ${SCHEMA_VERSION}`);
  if (!/^(dev|reg|hbk)-\d{3}$/.test(sample.sample_id || '')) fail(`sample_id must match ^(dev|reg|hbk)-\\d{3}$`);
  if (!Number.isInteger(sample.task_type) || !TASK_TYPES.includes(sample.task_type)) fail(`task_type must be 1..15`);
  if (!isNonEmptyString(sample.title)) fail('title required');
  if (!isNonEmptyString(sample.narrative)) fail('narrative required');
  if (!isNonEmptyString(sample.goal)) fail('goal required');

  if (!Array.isArray(sample.candidates) || sample.candidates.length < 1) fail('candidates must be non-empty array');
  const candIds = new Set();
  for (const c of sample.candidates || []) {
    if (!isNonEmptyString(c?.id)) fail('candidate.id required');
    else if (candIds.has(c.id)) fail(`duplicate candidate id ${c.id}`);
    else candIds.add(c.id);
    if (!isNonEmptyString(c?.label)) fail('candidate.label required');
  }

  for (const key of ['hard_constraints', 'soft_preferences']) {
    if (!Array.isArray(sample[key])) fail(`${key} must be array`);
  }

  const checkEvidence = (arr, key) => {
    if (!Array.isArray(arr)) { fail(`${key} must be array`); return; }
    for (const e of arr) {
      if (!isNonEmptyString(e?.entity_id)) fail(`${key}.entity_id required`);
      if (!isNonEmptyString(e?.content)) fail(`${key}.content required`);
    }
  };
  checkEvidence(sample.valid_evidence, 'valid_evidence');
  for (const e of sample.valid_evidence || []) {
    if (e.temporal_status !== 'current') fail('valid_evidence.temporal_status must be "current"');
  }
  checkEvidence(sample.expired_evidence, 'expired_evidence');
  for (const e of sample.expired_evidence || []) {
    if (e.temporal_status !== 'expired') fail('expired_evidence.temporal_status must be "expired"');
    if (!ISO_RE.test(e.valid_until || '')) fail('expired_evidence.valid_until must be ISO date-time');
    const until = Date.parse(e.valid_until);
    const maxT = Math.max(...(sample.memory_timeline || []).map((x) => Date.parse(x.t || '')));
    if (Number.isFinite(until) && Number.isFinite(maxT) && until >= maxT) {
      fail(`expired_evidence.valid_until (${e.valid_until}) must be before the latest timeline event`);
    }
  }
  checkEvidence(sample.conflicting_evidence, 'conflicting_evidence');
  for (const e of sample.conflicting_evidence || []) {
    if (!Number.isInteger(e?.group) || e.group < 1) fail('conflicting_evidence.group must be integer >= 1');
  }

  for (const key of ['historical_decisions', 'execution_results']) {
    if (!Array.isArray(sample[key])) fail(`${key} must be array`);
  }
  for (const d of sample.historical_decisions || []) {
    if (!isNonEmptyString(d?.decision_id)) fail('historical_decisions.decision_id required');
    if (!isNonEmptyString(d?.conclusion)) fail('historical_decisions.conclusion required');
    if (!['active', 'superseded', 'reversed', 'invalidated', 'under_review', 'continues'].includes(d?.status)) {
      fail('historical_decisions.status invalid');
    }
    if (d.revisit_at !== undefined && !ISO_RE.test(d.revisit_at)) fail('historical_decisions.revisit_at must be ISO');
  }
  for (const o of sample.execution_results || []) {
    if (!isNonEmptyString(o?.decision_id)) fail('execution_results.decision_id required');
    if (!isNonEmptyString(o?.actual_outcome)) fail('execution_results.actual_outcome required');
    if (typeof o?.outcome_score !== 'number' || o.outcome_score < 0 || o.outcome_score > 1) {
      fail('execution_results.outcome_score must be 0..1');
    }
    if (!ISO_RE.test(o?.outcome_timestamp || '')) fail('execution_results.outcome_timestamp must be ISO');
  }
  if ((sample.execution_results || []).length > 0) {
    const latest = [...sample.execution_results]
      .sort((a, b) => Date.parse(a.outcome_timestamp) - Date.parse(b.outcome_timestamp))
      .at(-1);
    const derived = latest.outcome_score < 0.5 ? 'revise' : 'persist';
    if (sample.expected_decision_action !== derived) {
      fail(`execution_results imply expected action ${derived}, got ${sample.expected_decision_action}`);
    }
  }

  if (!ACTIONS.includes(sample.expected_decision_action)) fail('expected_decision_action invalid');
  const legalActions = LEGAL_ACTIONS_BY_TYPE[sample.task_type] || [];
  if (!legalActions.includes(sample.expected_decision_action)) {
    fail(`expected_decision_action ${sample.expected_decision_action} not legal for task_type ${sample.task_type}`);
  }

  const detail = sample.expected_action_detail || {};
  if (detail.action !== sample.expected_decision_action) fail('expected_action_detail.action must equal expected_decision_action');
  if (detail.selected_candidate !== null && detail.selected_candidate !== undefined && !candIds.has(detail.selected_candidate)) {
    fail(`expected_action_detail.selected_candidate ${detail.selected_candidate} not in candidates`);
  }
  if (sample.expected_decision_action === 'decide' && !candIds.has(detail.selected_candidate)) {
    fail('decide requires a valid selected_candidate');
  }
  if (sample.expected_decision_action === 'clarify' && detail.selected_candidate !== null) {
    fail('clarify must have selected_candidate null');
  }

  if (!Array.isArray(sample.acceptable_explanation) || sample.acceptable_explanation.length < 1) {
    fail('acceptable_explanation must be non-empty array');
  }
  for (const entry of sample.acceptable_explanation || []) {
    if (!isNonEmptyString(entry?.feature)) fail('acceptable_explanation.feature required');
    if (!Array.isArray(entry?.must_mention) || entry.must_mention.length < 1) {
      fail('acceptable_explanation.must_mention must be non-empty array');
    }
  }

  if (!SEVERE_LABELS.includes(sample.severe_failure_label)) fail('severe_failure_label invalid');
  if (!Array.isArray(sample.tags)) fail('tags must be array');

  if (!Array.isArray(sample.memory_timeline) || sample.memory_timeline.length < 1) fail('memory_timeline must be non-empty');
  for (const ev of sample.memory_timeline || []) {
    if (!ISO_RE.test(ev?.t || '')) fail('memory_timeline.t must be ISO date-time');
    if (!TIMELINE_KINDS.includes(ev?.kind)) fail(`memory_timeline.kind invalid: ${ev?.kind}`);
    if (!isNonEmptyString(ev?.content)) fail('memory_timeline.content required');
  }

  // Semantic timeline checks
  const kinds = (sample.memory_timeline || []).map((e) => e.kind);
  if (sample.task_type === 14) {
    const due = kinds.includes('revisit_due');
    const hasRevisit = (sample.historical_decisions || []).some((d) => d.revisit_at);
    if (!due && !hasRevisit) fail('task_type 14 must have revisit_due timeline event or revisit_at decision');
  }
  if (sample.task_type === 15) {
    if (!kinds.includes('evidence_deleted')) fail('task_type 15 must have evidence_deleted timeline event');
  }
  if (sample.task_type === 4) {
    if ((sample.expired_evidence || []).length === 0) fail('task_type 4 must have expired_evidence');
  }
  if ([6, 7, 10, 11].includes(sample.task_type)) {
    if ((sample.historical_decisions || []).length === 0) fail(`task_type ${sample.task_type} must have historical_decisions`);
  }

  return errors;
}

export function loadFixtures(path) {
  return readFileSync(path, 'utf-8').split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      let sample;
      try { sample = JSON.parse(line); } catch (e) { throw new Error(`invalid JSON at ${path} line ${i + 1}: ${e.message}`); }
      return sample;
    });
}
