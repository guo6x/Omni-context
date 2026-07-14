import { CATEGORY_KEYS, FORGETTING_CAPABILITIES } from './constants.mjs';

const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const norm = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function phrasePresent(text, value) {
  const target = norm(value);
  if (!target) return false;
  if (text.includes(target)) return true;
  const tokens = [...new Set(target.split(' ').filter(Boolean))];
  const available = new Set(text.split(' ').filter(Boolean));
  return tokens.length > 0 && tokens.every((token) => available.has(token));
}

const coverage = (text, values = []) => values.length ? values.filter((value) => phrasePresent(text, value)).length / values.length : 1;
const rate = (text, values = []) => values.length ? values.filter((value) => phrasePresent(text, value)).length / values.length : 0;
const factText = (answer, states = null) => norm((answer?.facts || []).filter((fact) => !states || states.includes(fact.state)).flatMap((fact) => [fact.key, fact.value]).join(' '));

function positiveText(answer) {
  return norm([answer?.answer, ...(answer?.facts || []).flatMap((fact) => [fact.key, fact.value]), ...(answer?.constraints_used || [])].join(' '));
}

function transitionCoverage(answer, expected = []) {
  if (!expected.length) return 1;
  const transitions = answer?.transitions || [];
  return expected.filter((gold) => transitions.some((transition) => norm(transition.key) === norm(gold.key) && phrasePresent(norm(transition.from_value), gold.from_value) && phrasePresent(norm(transition.to_value), gold.to_value))).length / expected.length;
}

function rejectionCoverage(answer, values = []) {
  if (!values.length) return 1;
  const validReasons = new Set(['stale', 'invalidated', 'low_confidence', 'contradicted', 'noise', 'unsupported']);
  return values.filter((value) => (answer?.rejected_facts || []).some((item) => validReasons.has(item.reason) && phrasePresent(norm(item.value), value))).length / values.length;
}

function unsupportedRate(answer, visibleSourceIds, mode) {
  const visible = new Set(visibleSourceIds || []);
  const references = [
    ...(answer?.facts || []).map((item) => item.source_ids),
    ...(answer?.transitions || []).map((item) => item.source_ids),
    ...(answer?.rejected_facts || []).map((item) => item.source_ids),
  ];
  if (!references.length) return 0;
  const unsupported = references.filter((ids) => !Array.isArray(ids) || ids.some((id) => !visible.has(id)) || (mode !== 'no_memory' && ids.length === 0)).length;
  return unsupported / references.length;
}

function provenanceCoverage(answer, expectedAgents = [], visibleAgents = []) {
  if (!expectedAgents.length) return 1;
  const visible = new Set(visibleAgents);
  const cited = new Set((answer?.facts || []).flatMap((fact) => fact.source_agents || []).filter((agent) => visible.has(agent)));
  return expectedAgents.filter((agent) => cited.has(agent)).length / expectedAgents.length;
}

function staleLeakage(answer, staleValues = [], currentValues = []) {
  if (!staleValues.length) return 0;
  const currentOrSupported = factText(answer, ['current', 'supported']);
  const constraints = norm(answer?.constraints_used || []);
  const historical = factText(answer, ['historical']);
  const narrative = norm(answer?.answer);
  const leaked = staleValues.filter((value, index) => {
    if (phrasePresent(currentOrSupported, value) || phrasePresent(constraints, value)) return true;
    if (!phrasePresent(narrative, value)) return false;
    const isHistorical = phrasePresent(historical, value);
    const transition = (answer?.transitions || []).some((item) => phrasePresent(norm(item.from_value), value) && (!currentValues[index] || phrasePresent(norm(item.to_value), currentValues[index])));
    return !isHistorical && !transition;
  }).length;
  return leaked / staleValues.length;
}

export function scoreScenario({ scenario, answer, visibleSourceIds = [], visibleAgents = [], judge = null, mode = 'full_omni' }) {
  const g = scenario.gold || {};
  const positive = positiveText(answer);
  const affirmed = factText(answer, ['current', 'supported']);
  const current = factText(answer, ['current']);
  const historical = factText(answer, ['historical']);
  const required = coverage(positive, g.required_facts);
  const constraints = coverage(norm(answer?.constraints_used || []), g.required_constraints);
  const forbidden = rate(affirmed, g.forbidden_facts);
  const unsupported = unsupportedRate(answer, visibleSourceIds, mode);
  let metrics;

  switch (scenario.category) {
    case 'cognitive_continuity':
      metrics = { profile_recall: required, profile_consistency: 1 - forbidden, constraint_utilization: constraints, personalization_accuracy: avg([required, constraints]), contradiction_rate: forbidden, unsupported_personalization_rate: unsupported };
      break;
    case 'memory_evolution': {
      const currentScore = coverage(current, g.current_facts);
      const historicalScore = coverage(historical, g.historical_facts);
      const ordering = transitionCoverage(answer, g.transitions);
      const stale = staleLeakage(answer, g.stale_as_current, g.current_facts);
      metrics = { current_state_accuracy: currentScore, historical_state_preservation: historicalScore, temporal_ordering_accuracy: ordering, evolution_interpretation_accuracy: avg([currentScore, historicalScore, ordering]), stale_memory_leakage: stale, state_transition_accuracy: avg([currentScore, historicalScore, ordering, 1 - stale]) };
      break;
    }
    case 'conflict_resolution': {
      const currentScore = coverage(current, g.current_facts);
      const historicalScore = coverage(historical, g.historical_facts);
      const rejected = rejectionCoverage(answer, g.invalidated_facts);
      metrics = { conflict_resolution_accuracy: avg([currentScore, rejected, 1 - forbidden]), latest_valid_fact_accuracy: currentScore, historical_query_accuracy: historicalScore, invalidated_fact_rejection: rejected, conflict_disclosure_accuracy: Math.min(1, rate(norm(answer?.answer), g.conflict_disclosure) * 2), unsupported_resolution_rate: unsupported };
      break;
    }
    case 'cross_agent_transfer': {
      const provenance = provenanceCoverage(answer, g.required_sources, visibleAgents);
      metrics = { cross_agent_recall: required, cross_agent_consistency: 1 - forbidden, update_propagation_accuracy: coverage(current, g.current_facts), provenance_preservation: provenance, agent_isolation_error_rate: forbidden, stale_transfer_rate: forbidden };
      break;
    }
    case 'human_like_forgetting': {
      const active = norm([affirmed, ...(answer?.constraints_used || [])].join(' '));
      const explicit = rejectionCoverage(answer, g.suppress);
      const retained = rate(active, g.suppress);
      const suppression = Math.max(explicit, 1 - retained);
      metrics = { salient_memory_retention: required, noise_suppression: suppression, false_forgetting_rate: 1 - required, stale_retention_rate: retained, memory_precision: avg([required, suppression]), memory_compression_ratio: null, invalidation_accuracy: rejectionCoverage(answer, g.invalidated_facts || []) };
      break;
    }
    case 'proactive_insight':
      metrics = { insight_precision: clamp(judge?.rubric_scores?.insight_precision), insight_recall: clamp(judge?.rubric_scores?.insight_recall), blind_spot_detection_rate: clamp(judge?.rubric_scores?.blind_spot_detection), constraint_awareness: clamp(judge?.rubric_scores?.constraint_awareness), actionability: clamp(judge?.rubric_scores?.actionability), unsupported_claim_rate: clamp(judge?.unsupported_claim_rate), redundant_insight_rate: clamp(judge?.redundant_insight_rate), overreach_rate: clamp(judge?.overreach_rate) };
      break;
    case 'decision_quality':
      metrics = { constraint_coverage: constraints, goal_alignment: clamp(judge?.rubric_scores?.goal_alignment), personalization: required, option_comparison_quality: clamp(judge?.rubric_scores?.option_comparison), risk_awareness: clamp(judge?.rubric_scores?.risk_awareness), actionability: clamp(judge?.rubric_scores?.actionability), internal_consistency: clamp(judge?.rubric_scores?.internal_consistency), unsupported_assumption_rate: clamp(judge?.unsupported_claim_rate), overall_decision_quality: clamp(judge?.rubric_scores?.overall_quality) };
      break;
    default: throw new Error(`Unknown category: ${scenario.category}`);
  }

  const negative = new Set(['contradiction_rate', 'unsupported_personalization_rate', 'stale_memory_leakage', 'unsupported_resolution_rate', 'agent_isolation_error_rate', 'stale_transfer_rate', 'false_forgetting_rate', 'stale_retention_rate', 'unsupported_claim_rate', 'redundant_insight_rate', 'overreach_rate', 'unsupported_assumption_rate']);
  const implemented = Object.entries(metrics).filter(([, value]) => value !== null);
  return {
    status: 'completed',
    category: scenario.category,
    metrics,
    core_score: avg(implemented.map(([key, value]) => negative.has(key) ? 1 - clamp(value) : clamp(value))),
    deterministic: !['proactive_insight', 'decision_quality'].includes(scenario.category),
    judge_independent: judge ? true : null,
    scoring_version: 'deterministic-scoring-v3',
    forgetting_capabilities: scenario.category === 'human_like_forgetting' ? FORGETTING_CAPABILITIES : undefined,
  };
}

export function aggregateResults(records) {
  const completed = records.filter((record) => record.status === 'completed');
  const byCategory = {};
  for (const category of CATEGORY_KEYS) {
    const rows = completed.filter((record) => record.category === category);
    const metricKeys = [...new Set(rows.flatMap((row) => Object.keys(row.score?.metrics || {})))];
    byCategory[category] = { count: rows.length, macro_score: avg(rows.map((row) => row.score.core_score)), metrics: Object.fromEntries(metricKeys.map((key) => [key, avg(rows.map((row) => row.score.metrics[key]).filter((value) => value !== null && value !== undefined))])), status: rows.length ? 'completed' : 'blocked' };
  }
  const categoryScores = Object.values(byCategory).map((entry) => entry.macro_score).filter((value) => value !== null);
  const deterministicRows = completed.filter((row) => row.score?.deterministic);
  const judgedRows = completed.filter((row) => row.score?.deterministic === false);
  return {
    scoring_version: 'deterministic-scoring-v3',
    overall_cognitive_score: avg(categoryScores),
    category_macro_scores: Object.fromEntries(Object.entries(byCategory).map(([key, value]) => [key, value.macro_score])),
    deterministic_score: avg(deterministicRows.map((row) => row.score.core_score)),
    agent_judged_score: avg(judgedRows.map((row) => row.score.core_score)),
    memory_reliability_score: avg(['memory_evolution', 'conflict_resolution', 'cross_agent_transfer', 'human_like_forgetting'].map((key) => byCategory[key].macro_score).filter((value) => value !== null)),
    personalization_score: byCategory.cognitive_continuity.macro_score,
    temporal_and_conflict_score: avg(['memory_evolution', 'conflict_resolution'].map((key) => byCategory[key].macro_score).filter((value) => value !== null)),
    insight_and_decision_score: avg(['proactive_insight', 'decision_quality'].map((key) => byCategory[key].macro_score).filter((value) => value !== null)),
    by_category: byCategory,
    completed: completed.length,
    errors: records.filter((record) => record.status === 'error').length,
    primary_judge_independent: true,
  };
}
