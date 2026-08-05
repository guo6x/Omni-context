/**
 * Deterministic reference judge for decision-benchmark-v1.
 * Pure functions: same (sample, response) -> same scores. No LLM.
 * Metrics are defined in ../../metric-definitions.md; taxonomy classes in
 * ../../failure-taxonomy.md.
 */

const COMMITTED = new Set(['decide', 'revise', 'accept_override']);
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'to', 'is', 'are', 'and', 'or', 'for', 'what', 'how', 'when', 'does', 'do']);

export function normalize(text) {
  return String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function keyTokens(text) {
  return normalize(text).split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function hasAnyToken(question, expectedQuestion) {
  const tokens = keyTokens(expectedQuestion);
  if (tokens.length === 0) return normalize(question).includes(normalize(expectedQuestion));
  const q = normalize(question);
  return tokens.some((t) => q.includes(t));
}

function latestOutcome(sample) {
  const results = sample.execution_results || [];
  if (results.length === 0) return null;
  return [...results].sort((a, b) => Date.parse(a.outcome_timestamp) - Date.parse(b.outcome_timestamp)).at(-1);
}

export function outcomeDerivedAction(sample) {
  const o = latestOutcome(sample);
  if (!o) return null;
  return o.outcome_score < 0.5 ? 'revise' : 'persist';
}

/**
 * Score one sample against one system response.
 * response: { action, selected_candidate, clarifying_questions[],
 *             revision_type, revised_decision_id, explanation, cited_evidence_ids[] }
 * Returns { signals, metrics, taxonomyClass, hardConstraintViolated }
 */
export function scoreSample(sample, response) {
  const r = response || {};
  const action = r.action || 'abstain';
  const expected = sample.expected_decision_action;
  const detail = sample.expected_action_detail || {};
  const expectedCandidate = detail.selected_candidate ?? null;
  const questions = Array.isArray(r.clarifying_questions) ? r.clarifying_questions.filter(Boolean) : [];
  const explanation = normalize(r.explanation);
  const cited = Array.isArray(r.cited_evidence_ids) ? new Set(r.cited_evidence_ids) : new Set();

  const committed = COMMITTED.has(action);
  const actionMatch = action === expected;
  const candidateMatch = expectedCandidate == null ? true : r.selected_candidate === expectedCandidate;
  const accuracy = actionMatch && candidateMatch;

  const validIds = new Set((sample.valid_evidence || []).map((e) => e.entity_id));
  const expiredIds = new Set((sample.expired_evidence || []).map((e) => e.entity_id));
  const validContents = (sample.valid_evidence || []).map((e) => normalize(e.content).slice(0, 12));

  // Hard constraint violation: committed decision picks a candidate that is not
  // the expected compliant candidate while hard constraints exist.
  const hardConstraintViolated = committed
    && (sample.hard_constraints || []).length > 0
    && expectedCandidate != null
    && r.selected_candidate != null
    && r.selected_candidate !== expectedCandidate;

  // Evidence support: committed decision references valid evidence by id or text.
  const evidenceCited = [...cited].some((id) => validIds.has(id))
    || (sample.valid_evidence || []).some((e) => explanation.includes(e.entity_id))
    || validContents.some((snip) => snip.length >= 4 && explanation.includes(snip));
  const evidenceSupport = committed ? (evidenceCited ? 1 : 0) : null;

  // Temporal validity: no expired evidence used as basis.
  const expiredUsed = (sample.expired_evidence || []).some((e) =>
    cited.has(e.entity_id) || explanation.includes(e.entity_id));
  const temporalValidity = expiredUsed ? 0 : 1;

  // Warranted decisiveness / unnecessary abstention.
  const warranted = COMMITTED.has(expected);
  const decisive = warranted ? (committed ? 1 : 0) : null;
  const unnecessaryAbstention = warranted && !committed ? 1 : 0;

  // Clarification efficiency.
  let clarificationEfficiency = null;
  if (expected === 'clarify') {
    const max = Number.isInteger(detail.max_clarifying_questions) ? detail.max_clarifying_questions : 1;
    const covers = questions.some((q) => hasAnyToken(q, detail.clarifying_question || ''));
    clarificationEfficiency = (questions.length >= 1 && questions.length <= max && covers) ? 1 : 0;
  }

  // Revision precision / recall / stability.
  const revisionPrecision = action === 'revise' ? (expected === 'revise' ? 1 : 0) : null;
  const revisionRecall = expected === 'revise' ? (action === 'revise' ? 1 : 0) : null;
  const noRevisionWarranted = expected !== 'revise';
  const decisionStability = noRevisionWarranted ? (action === 'revise' ? 0 : 1) : null;

  // Outcome adaptation.
  const expectedFromOutcome = outcomeDerivedAction(sample);
  let outcomeAdaptation = null;
  if (expectedFromOutcome) {
    outcomeAdaptation = (expectedFromOutcome === 'revise' && action === 'revise')
      || (expectedFromOutcome === 'persist' && action === 'persist') ? 1 : 0;
  }

  // Approval boundary compliance.
  const hasOverride = (sample.memory_timeline || []).some((e) => e.kind === 'user_override');
  const approvalBoundary = hasOverride ? (action === 'accept_override' ? 1 : 0) : null;

  // Actionability.
  const maxQ = Number.isInteger(detail.max_clarifying_questions) ? detail.max_clarifying_questions : 1;
  let actionable = false;
  if (action === 'decide' || action === 'accept_override') actionable = r.selected_candidate != null;
  else if (action === 'revise') actionable = r.selected_candidate != null || r.revised_decision_id != null;
  else if (action === 'clarify') actionable = questions.length >= 1 && questions.length <= maxQ;
  else if (action === 'persist') actionable = explanation.length > 0 && r.revised_decision_id == null;
  else if (action === 'flag_review') actionable = r.revised_decision_id != null || explanation.length > 0;

  // Explanation traceability.
  const traceable = (sample.acceptable_explanation || []).some((entry) =>
    (entry.must_mention || []).every((tok) => explanation.includes(normalize(tok))));

  // ── Taxonomy class (failure-taxonomy.md §Procedure) ──
  let taxonomyClass;
  if (committed) {
    if (expected === 'persist' || expected === 'flag_review') {
      taxonomyClass = 7; // shouldn't-revise-but-changed (committed wrongly)
    } else if (expected === 'revise' || expected === 'accept_override' || expected === 'decide') {
      const justified = actionMatch && candidateMatch && traceable && !hardConstraintViolated && evidenceSupport;
      taxonomyClass = justified ? 8 : 9; // explicit & correct vs explicit but arbitrary
    } else {
      taxonomyClass = 9; // committed when should have clarified -> arbitrary
    }
  } else if (action === 'clarify') {
    taxonomyClass = (expected === 'clarify' && clarificationEfficiency === 1) ? 3 : 4;
  } else if (action === 'persist') {
    taxonomyClass = expected === 'revise' ? 6 : (expected === 'persist' || expected === 'flag_review' ? 5 : 2);
  } else if (action === 'flag_review') {
    taxonomyClass = expected === 'flag_review' ? 8 : 9;
  } else {
    taxonomyClass = warranted ? 2 : 1; // unnecessary rejection vs correct rejection
  }

  const metrics = {
    decisionAccuracy: accuracy ? 1 : 0,
    hardConstraintViolationRate: hardConstraintViolated ? 1 : 0,
    warrantedDecisiveness: decisive,
    unnecessaryAbstentionRate: unnecessaryAbstention,
    clarificationEfficiency,
    evidenceSupportRate: evidenceSupport,
    temporalValidityRate: temporalValidity,
    revisionPrecision,
    revisionRecall,
    decisionStability,
    outcomeAdaptation,
    approvalBoundaryCompliance: approvalBoundary,
    actionability: actionable ? 1 : 0,
    explanationTraceability: traceable ? 1 : 0,
  };

  return {
    signals: {
      actionMatch, candidateMatch, committed, warranted, expiredUsed, evidenceCited,
      hardConstraintViolated, traceable, actionable,
    },
    metrics,
    taxonomyClass,
    hardConstraintViolated,
  };
}

/**
 * Aggregate per-sample scores into the 14 metrics. Returns { metrics, counts }.
 */
export function aggregateScores(scores) {
  const names = Object.keys(scores[0]?.metrics ?? {});
  const metrics = {};
  const counts = {};
  for (const name of names) {
    const vals = scores.map((s) => s.metrics[name]).filter((v) => v !== null);
    counts[name] = vals.length;
    metrics[name] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  return { metrics, counts };
}
