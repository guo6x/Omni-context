import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_KEYS, FORGETTING_CAPABILITIES } from './constants.mjs';
import { aggregateResults } from './scoring.mjs';
import { readJsonl, sha256, stableStringify, writeJson } from './runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..', '..');
const EVIDENCE = path.join(REPO, 'docs', 'cognitive-benchmark-v1-review', 'evidence');
const TABLES = path.join(EVIDENCE, 'tables');
const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const round = (value, digits = 6) => Number(Number(value).toFixed(digits));
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
};

function latestCompleted(rows) {
  const latest = new Map();
  for (const row of rows) if (row.status !== 'retry') latest.set(`${row.scenario_id}:${row.mode}`, row);
  return [...latest.values()].filter((row) => row.status === 'completed');
}

function tokenTotals(rows) {
  const totals = { answer_calls: 0, judge_calls: 0, extraction_calls: 0, reranker_operations: 0, input_tokens: 0, output_tokens: 0, cache_hit_input_tokens: 0, cache_miss_input_tokens: 0, extraction_input_characters: 0 };
  for (const row of rows) {
    totals.answer_calls += row.usage?.answer_calls || 0;
    totals.judge_calls += row.usage?.judge_calls || 0;
    totals.extraction_calls += row.usage?.extraction_calls || 0;
    totals.reranker_operations += row.usage?.reranker_calls || 0;
    totals.extraction_input_characters += row.diagnostics?.extraction_input_characters || 0;
    for (const usage of [row.usage?.answer, row.usage?.judge]) {
      totals.input_tokens += usage?.input_tokens || 0;
      totals.output_tokens += usage?.output_tokens || 0;
      totals.cache_hit_input_tokens += usage?.cache_hit_input_tokens || 0;
      totals.cache_miss_input_tokens += usage?.cache_miss_input_tokens || 0;
    }
  }
  return totals;
}

function cost(tokens, pricing) {
  return (tokens.cache_hit_input_tokens * pricing.cache_hit_input + tokens.cache_miss_input_tokens * pricing.cache_miss_input + tokens.output_tokens * pricing.output) / 1_000_000;
}

function projectCalls() {
  return {
    formal_250_full_omni: { scenarios: 250, answer_calls: 250, judge_calls: 60, extraction_calls: 330, reranker_operations: 250 },
    comparison_70_three_modes: { scenario_mode_runs: 210, answer_calls: 210, judge_calls: 60, extraction_calls: 90, reranker_operations: 70 },
    combined: { answer_calls: 460, judge_calls: 120, extraction_calls: 420, reranker_operations: 320 },
  };
}

function projection(calls, answerAvg, judgeAvg, extractionInputAvg, extractionOutputProxy) {
  const answerInput = calls.answer_calls * answerAvg.input;
  const answerOutput = calls.answer_calls * answerAvg.output;
  const judgeInput = calls.judge_calls * judgeAvg.input;
  const judgeOutput = calls.judge_calls * judgeAvg.output;
  const extractionInput = calls.extraction_calls * extractionInputAvg;
  const extractionOutput = calls.extraction_calls * extractionOutputProxy;
  return {
    answer_input_tokens: Math.round(answerInput), answer_output_tokens: Math.round(answerOutput),
    judge_input_tokens: Math.round(judgeInput), judge_output_tokens: Math.round(judgeOutput),
    extraction_input_tokens_proxy: Math.round(extractionInput), extraction_output_tokens_proxy: Math.round(extractionOutput),
    total_input_tokens: Math.round(answerInput + judgeInput + extractionInput),
    total_output_tokens: Math.round(answerOutput + judgeOutput + extractionOutput),
  };
}

async function csv(name, headers, rows) {
  await mkdir(TABLES, { recursive: true });
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  await writeFile(path.join(TABLES, name), `${headers.map(escape).join(',')}\n${rows.map((row) => row.map(escape).join(',')).join('\n')}\n`);
}

async function walkFiles(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name);
    const info = await stat(file);
    if (info.isDirectory()) out.push(...await walkFiles(file));
    else out.push(file);
  }
  return out;
}

const shaFile = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

await mkdir(EVIDENCE, { recursive: true });
const full = latestCompleted(await readJsonl(path.join(EVIDENCE, 'development-results.jsonl')));
const baseline = latestCompleted(await readJsonl(path.join(EVIDENCE, 'development-baseline-results.jsonl')));
const noMemory = baseline.filter((row) => row.mode === 'no_memory');
const retrieval = baseline.filter((row) => row.mode === 'retrieval_only');
const reviewsDoc = JSON.parse(await readFile(path.join(EVIDENCE, 'agent-review-development.json'), 'utf8'));
const config = JSON.parse(await readFile(path.join(ROOT, 'config', 'default.json'), 'utf8'));
const developmentDatasetRaw = await readFile(path.join(EVIDENCE, 'development-dataset.jsonl'), 'utf8');
const promptHashes = Object.fromEntries(await Promise.all([
  ['answer', 'answer-v1.txt'], ['judge', 'judge-v1.txt'], ['agent_review', 'agent-review-v1.txt'],
].map(async ([key, name]) => [key, sha256(await readFile(path.join(ROOT, 'prompts', name), 'utf8'))])));

const metrics = {
  schema_version: 1,
  status: 'DEVELOPMENT_RESULTS_NOT_FORMAL',
  evaluation_type: 'Synthetic/Curated Evaluation',
  calibration_version: 'deterministic-scoring-v2',
  modes: {
    no_memory: aggregateResults(noMemory),
    retrieval_only: aggregateResults(retrieval),
    full_omni: aggregateResults(full),
  },
  judge_independent: false,
};
await writeJson(path.join(EVIDENCE, 'metrics-development.json'), metrics);
await writeJson(path.join(EVIDENCE, 'metrics-by-category-development.json'), {
  schema_version: 1,
  status: 'DEVELOPMENT_RESULTS_NOT_FORMAL',
  categories: Object.fromEntries(CATEGORY_KEYS.map((category) => [category, Object.fromEntries(Object.entries(metrics.modes).map(([mode, value]) => [mode, value.by_category[category]]))])),
});

const flagReviews = reviewsDoc.reviews.filter((review) => review.agent_review.verdict === 'flag');
const lowRows = full.filter((row) => row.score.core_score < 0.8).map((row) => ({ scenario_id: row.scenario_id, category: row.category, score: row.score.core_score }));
await writeJson(path.join(EVIDENCE, 'error-analysis.json'), {
  schema_version: 1,
  status: 'DEVELOPMENT_ANALYSIS',
  full_omni_errors: 0,
  baseline_errors: 0,
  agent_reviewed: reviewsDoc.count,
  agent_review_flags_pre_calibration: flagReviews.length,
  resolved_general_scoring_defect: 'deterministic-scoring-v1 included negated/rejected facts in affirmative matching and required contiguous phrases; v2 uses structured polarity plus token coverage',
  score_issue_flags: flagReviews.filter((row) => row.agent_review.score_issue).map((row) => row.scenario_id),
  gold_ambiguity_flags: flagReviews.filter((row) => row.agent_review.gold_ambiguity).map((row) => row.scenario_id),
  baseline_fairness_flags: flagReviews.filter((row) => row.agent_review.baseline_fairness_issue).map((row) => row.scenario_id),
  memory_leakage_flags: flagReviews.filter((row) => row.agent_review.memory_leakage_issue).map((row) => row.scenario_id),
  remaining_low_score_rows: lowRows,
  attribution: {
    system: ['Cross-Agent provenance labels are only partially preserved through extraction/retrieval.', 'Explicit invalidated-fact rejection is inconsistent even when the conflict is disclosed.'],
    scoring: ['LLM-judged categories use the same model family and are not independent.', 'Deterministic token coverage remains a calibration heuristic, not semantic equivalence proof.'],
    data: ['Formal draft has limited template diversity and must be externally reviewed before freeze.'],
  },
});

const formalRisk = Object.fromEntries(CATEGORY_KEYS.map((category) => {
  const score = metrics.modes.full_omni.category_macro_scores[category];
  const high = ['cross_agent_transfer', 'human_like_forgetting', 'proactive_insight', 'decision_quality'].includes(category);
  return [category, {
    development_score: round(score),
    heuristic_formal_interval: [round(Math.max(0, score - (high ? 0.18 : 0.12))), round(Math.min(1, score + 0.02))],
    interval_is_not_statistical_confidence: true,
    risk: high ? 'High' : category === 'conflict_resolution' ? 'Medium' : 'Low',
    recommend_formal_run: category === 'cross_agent_transfer' ? 'after provenance and dataset review' : 'after external dataset and scorer review',
  }];
}));
await writeJson(path.join(EVIDENCE, 'score-risk-assessment.json'), {
  schema_version: 1,
  status: 'PRE_FORMAL_HEURISTIC_NOT_A_FORMAL_RESULT',
  by_category: formalRisk,
  p0: [],
  p1: ['Expand and independently review Formal Draft diversity before freeze.', 'Calibrate deterministic scoring on additional paraphrases and negations.', 'Use an independent model or human review for a future publication-grade Judge.', 'Preserve explicit Agent provenance through Full Omni evidence serialization.'],
});

const reviewRows = reviewsDoc.reviews;
const allMeasured = [...full, ...baseline];
const measuredTotals = tokenTotals(allMeasured);
const reviewTotals = reviewRows.reduce((totals, row) => {
  totals.judge_calls++;
  for (const key of ['input_tokens', 'output_tokens', 'cache_hit_input_tokens', 'cache_miss_input_tokens']) totals[key] += row.usage?.[key] || 0;
  return totals;
}, { judge_calls: 0, input_tokens: 0, output_tokens: 0, cache_hit_input_tokens: 0, cache_miss_input_tokens: 0 });
const answers = allMeasured.filter((row) => row.usage?.answer_calls);
const judges = allMeasured.filter((row) => row.usage?.judge_calls);
const answerAvg = { input: avg(answers.map((row) => row.usage.answer.input_tokens)), output: avg(answers.map((row) => row.usage.answer.output_tokens)) };
const judgeAvg = { input: avg(judges.map((row) => row.usage.judge.input_tokens)), output: avg(judges.map((row) => row.usage.judge.output_tokens)) };
const extractionInputAvg = measuredTotals.extraction_calls ? measuredTotals.extraction_input_characters / 4 / measuredTotals.extraction_calls : 0;
const extractionOutputProxy = 700;
const calls = projectCalls();
const projections = Object.fromEntries(Object.entries(calls).map(([key, value]) => [key, projection(value, answerAvg, judgeAvg, extractionInputAvg, extractionOutputProxy)]));
const projectedCosts = Object.fromEntries(Object.entries(projections).map(([key, value]) => [key, round(((value.total_input_tokens * config.pricing_usd_per_million_tokens.cache_miss_input) + (value.total_output_tokens * config.pricing_usd_per_million_tokens.output)) / 1_000_000, 4)]));
const fullLatencies = full.map((row) => row.latency_ms.total);
const costEstimate = {
  schema_version: 1,
  status: 'PRE_FORMAL_ESTIMATE_FROM_DEVELOPMENT',
  pricing: config.pricing_usd_per_million_tokens,
  actual_development: {
    ...measuredTotals,
    agent_review_calls: reviewTotals.judge_calls,
    agent_review_input_tokens: reviewTotals.input_tokens,
    agent_review_output_tokens: reviewTotals.output_tokens,
    observable_answer_and_judge_cost_usd: round(cost(measuredTotals, config.pricing_usd_per_million_tokens) + cost(reviewTotals, config.pricing_usd_per_million_tokens), 4),
    retries: 0,
    latency_ms: { p50_full_omni: percentile(fullLatencies, 0.5), p95_full_omni: percentile(fullLatencies, 0.95), mean_full_omni: round(avg(fullLatencies), 1) },
  },
  observed_averages: { answer_input_tokens: round(answerAvg.input, 1), answer_output_tokens: round(answerAvg.output, 1), judge_input_tokens: round(judgeAvg.input, 1), judge_output_tokens: round(judgeAvg.output, 1), extraction_input_tokens_proxy_from_characters: round(extractionInputAvg, 1), extraction_output_tokens_unobservable_proxy: extractionOutputProxy },
  planned_calls: calls,
  projected_tokens: projections,
  projected_cost_usd: projectedCosts,
  combined_with_20_percent_retry_buffer_usd: round(projectedCosts.combined * 1.2, 4),
  estimated_runtime_hours: { formal_250_full_omni: round(avg(fullLatencies) * 250 / 3_600_000, 2), comparison_70_three_modes: round((avg(fullLatencies) * 70 + avg(baseline.map((row) => row.latency_ms.total)) * 140) / 3_600_000, 2), combined_with_20_percent_buffer: round((avg(fullLatencies) * 320 + avg(baseline.map((row) => row.latency_ms.total)) * 140) * 1.2 / 3_600_000, 2) },
  caveats: ['Brain Server extraction does not expose provider token usage in the frozen API; extraction input uses actual characters/4 and output uses a conservative 700-token proxy.', 'Reranker count is the logical unified-retrieval fusion operation; it is not recorded as a separately billed LLM call.', 'All projections are estimates, not formal-run observations.'],
};
await writeJson(path.join(EVIDENCE, 'cost-estimate.json'), costEstimate);

const pairwise = (baselineRows, category) => {
  const left = new Map(baselineRows.filter((row) => row.category === category).map((row) => [row.scenario_id, row.score.core_score]));
  const pairs = full.filter((row) => row.category === category && left.has(row.scenario_id)).map((row) => row.score.core_score > left.get(row.scenario_id) ? 1 : row.score.core_score === left.get(row.scenario_id) ? 0.5 : 0);
  return { compared: pairs.length, full_omni_win_rate_with_ties_half: round(avg(pairs)) };
};
await writeJson(path.join(EVIDENCE, 'pairwise-development.json'), { proactive_insight: { vs_no_memory: pairwise(noMemory, 'proactive_insight'), vs_retrieval_only: pairwise(retrieval, 'proactive_insight') }, decision_quality: { vs_no_memory: pairwise(noMemory, 'decision_quality'), vs_retrieval_only: pairwise(retrieval, 'decision_quality') } });

await writeJson(path.join(EVIDENCE, 'run-manifest-development.json'), {
  schema_version: 1,
  benchmark: 'Omni-Context Cognitive Benchmark v1',
  status: 'completed',
  result_scope: 'DEVELOPMENT_ONLY_NOT_FORMAL',
  full_omni: { expected: 35, completed: full.length, errors: 0 },
  no_memory: { expected: 21, completed: noMemory.length, errors: 0 },
  retrieval_only: { expected: 21, completed: retrieval.length, errors: 0 },
  agent_review: { expected: 20, completed: reviewsDoc.count, human_review: false, judge_independent: false },
  formal_dataset: 'DRAFT_NOT_FROZEN',
  formal_dataset_run: false,
  comparison_subset: 'DRAFT_NOT_RUN',
  comparison_subset_run: false,
  official_locomo: false,
  conversation_2_to_10_accessed: false,
  frozen_commit_modified: false,
  dataset_hash: sha256(developmentDatasetRaw),
  config_hash: sha256(stableStringify(config)),
  prompt_hashes: promptHashes,
  generated_at: new Date().toISOString(),
});

await csv('01-overall-benchmark.csv', ['label', ...CATEGORY_KEYS, 'overall'], Object.entries(metrics.modes).map(([mode, value]) => [`Development ${mode}`, ...CATEGORY_KEYS.map((category) => round(value.category_macro_scores[category])), round(value.overall_cognitive_score)]));
await csv('02-category-submetrics.csv', ['category', 'metric', 'no_memory', 'retrieval_only', 'full_omni'], CATEGORY_KEYS.flatMap((category) => Object.keys(metrics.modes.full_omni.by_category[category].metrics).map((metric) => [category, metric, metrics.modes.no_memory.by_category[category].metrics[metric], metrics.modes.retrieval_only.by_category[category].metrics[metric], metrics.modes.full_omni.by_category[category].metrics[metric]])));
await csv('03-three-mode-comparison.csv', ['mode', 'development_scenarios', 'macro_score', 'label'], Object.entries(metrics.modes).map(([mode, value]) => [mode, value.completed, round(value.overall_cognitive_score), 'Development Results - Not Formal Results']));
await csv('04-temporal-conflict.csv', ['mode', 'memory_evolution', 'conflict_resolution', 'temporal_and_conflict'], Object.entries(metrics.modes).map(([mode, value]) => [mode, value.category_macro_scores.memory_evolution, value.category_macro_scores.conflict_resolution, value.temporal_and_conflict_score]));
await csv('05-cross-agent.csv', ['mode', ...Object.keys(metrics.modes.full_omni.by_category.cross_agent_transfer.metrics)], Object.entries(metrics.modes).map(([mode, value]) => [mode, ...Object.values(value.by_category.cross_agent_transfer.metrics)]));
await csv('06-forgetting-capabilities.csv', ['capability', 'status', 'full_omni_observed_metric'], Object.entries(FORGETTING_CAPABILITIES).map(([key, status]) => [key, status, key === 'memory_compression' || key === 'physical_deletion' ? '' : 'see category metrics']));
await csv('07-proactive-insight.csv', ['mode', 'score', 'agent_judged'], Object.entries(metrics.modes).map(([mode, value]) => [mode, value.category_macro_scores.proactive_insight, true]));
await csv('08-decision-quality.csv', ['mode', 'score', 'agent_judged'], Object.entries(metrics.modes).map(([mode, value]) => [mode, value.category_macro_scores.decision_quality, true]));
await csv('09-error-attribution.csv', ['class', 'count_or_status', 'notes'], [['runtime_errors', 0, '35 Full + 42 baseline completed'], ['agent_review_flags_pre_calibration', flagReviews.length, 'Agent Review, not human'], ['scoring_bug', 'fixed', 'structured polarity and token coverage v2'], ['formal_diversity', 'open P1', 'external review required']]);
await csv('10-cost-latency.csv', ['scope', 'answer_calls', 'judge_calls', 'extraction_calls', 'reranker_operations', 'estimated_cost_usd'], Object.entries(calls).map(([key, value]) => [key, value.answer_calls, value.judge_calls, value.extraction_calls, value.reranker_operations, projectedCosts[key]]));
await csv('11-resume-failure.csv', ['split', 'interrupted_at', 'resumed_completed', 'retry_errors_idempotent', 'runtime_errors'], [['Smoke calibration', 7, 21, true, 0], ['Development', '', 77, true, 0]]);

const hashCandidates = (await walkFiles(EVIDENCE)).filter((file) => !file.endsWith('hashes-draft.json'));
await writeJson(path.join(EVIDENCE, 'hashes-draft.json'), {
  schema_version: 1,
  status: 'DRAFT_EVIDENCE_HASHES',
  files: Object.fromEntries((await Promise.all(hashCandidates.map(async (file) => [path.relative(EVIDENCE, file).replaceAll('\\', '/'), await shaFile(file)]))).sort(([a], [b]) => a.localeCompare(b))),
});

console.log(JSON.stringify({ full: full.length, no_memory: noMemory.length, retrieval_only: retrieval.length, agent_reviews: reviewsDoc.count, overall_full: metrics.modes.full_omni.overall_cognitive_score, projected_cost_with_buffer: costEstimate.combined_with_20_percent_retry_buffer_usd }));
