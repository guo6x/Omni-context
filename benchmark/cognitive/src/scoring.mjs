import { CATEGORY_KEYS, FORGETTING_CAPABILITIES } from './constants.mjs';

const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const avg = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const norm = (value) => String(value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function answerText(answer) {
  return norm([answer?.answer, ...(answer?.facts || []).flatMap((f) => [f.key, f.value]), ...(answer?.constraints_used || []), ...(answer?.insights || []), ...(answer?.actions || []), answer?.uncertainty].join(' '));
}

function phrasePresent(text, value) {
  const target = norm(value);
  if (!target) return false;
  if (text.includes(target)) return true;
  const tokens = [...new Set(target.split(' ').filter(Boolean))];
  const haystack = new Set(text.split(' ').filter(Boolean));
  return tokens.length > 0 && tokens.every((token) => haystack.has(token));
}

function coverage(text, values = []) {
  if (!values.length) return 1;
  return values.filter((value) => phrasePresent(text, value)).length / values.length;
}

function ratePresent(text, values = []) {
  if (!values.length) return 0;
  return values.filter((value) => phrasePresent(text, value)).length / values.length;
}

const NEGATION_MARKERS = /\b(?:incorrect|invalidated|rejected|resolved|stale|noise|no longer|not current|low confidence|low-confidence|conflict|contradicted|historical)\b/i;

function polarityTexts(answer) {
  const rejected = answer?.rejected_facts || [];
  const positive = [];
  const negative = [...rejected];
  for (const fact of answer?.facts || []) {
    const rendered = `${fact.key || ''} ${fact.value || ''}`;
    const explicitlyRejected = rejected.some((value) => {
      const target = norm(value);
      const factText = norm(rendered);
      const tokens = target.split(' ').filter(Boolean);
      return target && (factText.includes(target) || tokens.every((token) => factText.includes(token)));
    });
    if (explicitlyRejected || NEGATION_MARKERS.test(rendered)) negative.push(rendered);
    else positive.push(rendered);
  }
  return { affirmed: norm(positive.join(' ')), negated: norm(negative.join(' ')) };
}

function sourceValidity(answer, visibleSourceIds) {
  const claims = answer?.facts || [];
  if (!claims.length) return 0;
  const visible = new Set(visibleSourceIds || []);
  const unsupported = claims.filter((claim) => !Array.isArray(claim.source_ids)
    || claim.source_ids.length === 0
    || claim.source_ids.some((id) => !visible.has(id))).length;
  return unsupported / claims.length;
}

export function scoreScenario({ scenario, answer, visibleSourceIds = [], judge = null }) {
  const text = answerText(answer);
  const polarity = polarityTexts(answer);
  const g = scenario.gold || {};
  const required = coverage(text, g.required_facts);
  const constraints = coverage(text, g.required_constraints);
  const forbidden = ratePresent(polarity.affirmed, g.forbidden_facts);
  const unsupported = sourceValidity(answer, visibleSourceIds);
  let metrics;

  switch (scenario.category) {
    case 'cognitive_continuity':
      metrics = {
        profile_recall: required,
        profile_consistency: 1 - forbidden,
        constraint_utilization: constraints,
        personalization_accuracy: avg([required, constraints]),
        contradiction_rate: forbidden,
        unsupported_personalization_rate: unsupported,
      };
      break;
    case 'memory_evolution': {
      const stale = ratePresent(norm(answer?.facts?.filter((f) => f.state === 'current').map((f) => f.value).join(' ')), g.stale_as_current);
      metrics = {
        current_state_accuracy: coverage(text, g.current_facts),
        historical_state_preservation: coverage(text, g.historical_facts),
        temporal_ordering_accuracy: text.includes('previous') || text.includes('histor') || text.includes('from') ? 1 : 0,
        evolution_interpretation_accuracy: required,
        stale_memory_leakage: stale,
        state_transition_accuracy: avg([coverage(text, g.current_facts), coverage(text, g.historical_facts), 1 - stale]),
      };
      break;
    }
    case 'conflict_resolution':
      metrics = {
        conflict_resolution_accuracy: avg([coverage(text, g.current_facts), 1 - forbidden]),
        latest_valid_fact_accuracy: coverage(text, g.current_facts),
        historical_query_accuracy: coverage(text, g.historical_facts),
        invalidated_fact_rejection: ratePresent(polarity.negated, g.invalidated_facts),
        conflict_disclosure_accuracy: Math.min(1, ratePresent(text, g.conflict_disclosure) * 2),
        unsupported_resolution_rate: unsupported,
      };
      break;
    case 'cross_agent_transfer':
      metrics = {
        cross_agent_recall: required,
        cross_agent_consistency: 1 - forbidden,
        update_propagation_accuracy: coverage(text, g.current_facts),
        provenance_preservation: coverage(text, g.required_sources),
        agent_isolation_error_rate: forbidden,
        stale_transfer_rate: forbidden,
      };
      break;
    case 'human_like_forgetting': {
      const retainedNoise = ratePresent(polarity.affirmed, g.suppress);
      const explicitSuppression = ratePresent(polarity.negated, g.suppress);
      const noiseSuppression = Math.max(1 - retainedNoise, explicitSuppression);
      metrics = {
        salient_memory_retention: required,
        noise_suppression: noiseSuppression,
        false_forgetting_rate: 1 - required,
        stale_retention_rate: 1 - noiseSuppression,
        memory_precision: avg([required, noiseSuppression]),
        memory_compression_ratio: null,
        invalidation_accuracy: 1 - forbidden,
      };
      break;
    }
    case 'proactive_insight':
      metrics = {
        insight_precision: clamp(judge?.rubric_scores?.insight_precision),
        insight_recall: clamp(judge?.rubric_scores?.insight_recall),
        blind_spot_detection_rate: clamp(judge?.rubric_scores?.blind_spot_detection),
        constraint_awareness: clamp(judge?.rubric_scores?.constraint_awareness),
        actionability: clamp(judge?.rubric_scores?.actionability),
        unsupported_claim_rate: clamp(judge?.unsupported_claim_rate),
        redundant_insight_rate: 0,
        overreach_rate: clamp(judge?.overreach_rate),
      };
      break;
    case 'decision_quality':
      metrics = {
        constraint_coverage: constraints,
        goal_alignment: clamp(judge?.rubric_scores?.goal_alignment),
        personalization: required,
        option_comparison_quality: clamp(judge?.rubric_scores?.option_comparison),
        risk_awareness: clamp(judge?.rubric_scores?.risk_awareness),
        actionability: clamp(judge?.rubric_scores?.actionability),
        internal_consistency: clamp(judge?.rubric_scores?.internal_consistency),
        unsupported_assumption_rate: clamp(judge?.unsupported_claim_rate),
        overall_decision_quality: clamp(judge?.rubric_scores?.overall_quality),
      };
      break;
    default: throw new Error(`Unknown category: ${scenario.category}`);
  }

  const negativeKeys = new Set(['contradiction_rate', 'unsupported_personalization_rate', 'stale_memory_leakage', 'unsupported_resolution_rate', 'agent_isolation_error_rate', 'stale_transfer_rate', 'false_forgetting_rate', 'stale_retention_rate', 'unsupported_claim_rate', 'redundant_insight_rate', 'overreach_rate', 'unsupported_assumption_rate']);
  const implementedEntries = Object.entries(metrics).filter(([, value]) => value !== null);
  const coreScore = avg(implementedEntries.map(([key, value]) => negativeKeys.has(key) ? 1 - clamp(value) : clamp(value)));
  return {
    status: 'completed',
    category: scenario.category,
    metrics,
    core_score: coreScore,
    deterministic: !['proactive_insight', 'decision_quality'].includes(scenario.category),
    judge_independent: judge ? false : null,
    forgetting_capabilities: scenario.category === 'human_like_forgetting' ? FORGETTING_CAPABILITIES : undefined,
  };
}

export function aggregateResults(records) {
  const completed = records.filter((record) => record.status === 'completed');
  const byCategory = {};
  for (const category of CATEGORY_KEYS) {
    const rows = completed.filter((record) => record.category === category);
    const metricKeys = [...new Set(rows.flatMap((row) => Object.keys(row.score?.metrics || {})))];
    byCategory[category] = {
      count: rows.length,
      macro_score: avg(rows.map((row) => row.score.core_score)),
      metrics: Object.fromEntries(metricKeys.map((key) => [key, avg(rows.map((row) => row.score.metrics[key]).filter((v) => v !== null && v !== undefined))])),
      status: rows.length ? 'completed' : 'blocked',
    };
  }
  const categoryScores = Object.values(byCategory).map((entry) => entry.macro_score).filter((v) => v !== null);
  const deterministicRows = completed.filter((row) => row.score?.deterministic);
  const judgedRows = completed.filter((row) => row.score?.deterministic === false);
  return {
    overall_cognitive_score: avg(categoryScores),
    category_macro_scores: Object.fromEntries(Object.entries(byCategory).map(([key, value]) => [key, value.macro_score])),
    deterministic_score: avg(deterministicRows.map((row) => row.score.core_score)),
    agent_judged_score: avg(judgedRows.map((row) => row.score.core_score)),
    memory_reliability_score: avg(['memory_evolution', 'conflict_resolution', 'cross_agent_transfer', 'human_like_forgetting'].map((key) => byCategory[key].macro_score).filter((v) => v !== null)),
    personalization_score: byCategory.cognitive_continuity.macro_score,
    temporal_and_conflict_score: avg(['memory_evolution', 'conflict_resolution'].map((key) => byCategory[key].macro_score).filter((v) => v !== null)),
    insight_and_decision_score: avg(['proactive_insight', 'decision_quality'].map((key) => byCategory[key].macro_score).filter((v) => v !== null)),
    by_category: byCategory,
    completed: completed.length,
    errors: records.filter((record) => record.status === 'error').length,
  };
}
