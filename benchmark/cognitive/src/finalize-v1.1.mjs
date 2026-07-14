import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateResults } from './scoring.mjs';
import { readJsonl, writeJson } from './runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..', '..');
const EVIDENCE = path.join(REPO, 'docs', 'cognitive-benchmark-v1.1-review', 'evidence');
const round = (value, digits = 6) => value === null ? null : Number(Number(value).toFixed(digits));
const avg = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * fraction;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};
const latestCompleted = async (name) => {
  const latest = new Map();
  for (const row of await readJsonl(path.join(EVIDENCE, name))) if (row.status !== 'retry') latest.set(`${row.scenario_id}:${row.mode}`, row);
  return [...latest.values()].filter((row) => row.status === 'completed');
};
const tokenTotals = (rows, role) => rows.reduce((total, row) => {
  const usage = row.usage?.[role] || {};
  for (const key of ['input_tokens', 'output_tokens', 'cache_hit_input_tokens', 'cache_miss_input_tokens', 'total_tokens', 'cached_tokens']) total[key] += usage[key] || 0;
  return total;
}, { input_tokens: 0, output_tokens: 0, cache_hit_input_tokens: 0, cache_miss_input_tokens: 0, total_tokens: 0, cached_tokens: 0 });
const cost = (tokens, pricing) => (tokens.cache_hit_input_tokens * pricing.cache_hit_input + tokens.cache_miss_input_tokens * pricing.cache_miss_input + tokens.output_tokens * pricing.output) / 1_000_000;
const pairwise = (full, baseline) => {
  const byId = new Map(baseline.map((row) => [row.scenario_id, row]));
  const pairs = full.filter((row) => byId.has(row.scenario_id)).map((row) => {
    const other = byId.get(row.scenario_id);
    const outcome = row.score.core_score > other.score.core_score ? 'win' : row.score.core_score < other.score.core_score ? 'loss' : 'tie';
    return { scenario_id: row.scenario_id, category: row.category, full_omni: row.score.core_score, baseline: other.score.core_score, outcome };
  });
  const wins = pairs.filter((pair) => pair.outcome === 'win').length;
  const losses = pairs.filter((pair) => pair.outcome === 'loss').length;
  const ties = pairs.filter((pair) => pair.outcome === 'tie').length;
  return { compared: pairs.length, wins, losses, ties, win_rate: round(wins / pairs.length), win_rate_with_ties_half: round((wins + ties * 0.5) / pairs.length), pairs };
};
const walk = async (dir) => {
  const out = [];
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name);
    const info = await stat(file);
    if (info.isDirectory()) out.push(...await walk(file)); else out.push(file);
  }
  return out;
};

const [full, noMemory, retrieval] = await Promise.all([
  latestCompleted('development-full-omni-results-v2.1.jsonl'),
  latestCompleted('development-no-memory-results-v2.1.jsonl'),
  latestCompleted('development-retrieval-only-results-v2.1.jsonl'),
]);
const [config, ledger, review] = await Promise.all([
  JSON.parse(await readFile(path.join(ROOT, 'config', 'default.json'), 'utf8')),
  JSON.parse(await readFile(path.join(EVIDENCE, 'kimi-usage-adapter-v2.1.json'), 'utf8')),
  JSON.parse(await readFile(path.join(EVIDENCE, 'secondary-agent-review-v2.1.json'), 'utf8')),
]);
const all = [...full, ...noMemory, ...retrieval];
const byMode = { full_omni: aggregateResults(full), no_memory: aggregateResults(noMemory), retrieval_only: aggregateResults(retrieval) };
const difficulty = Object.fromEntries(['easy', 'medium', 'hard'].map((level) => [level, Object.fromEntries(Object.entries({ full_omni: full, no_memory: noMemory, retrieval_only: retrieval }).map(([mode, rows]) => [mode, round(avg(rows.filter((row) => row.difficulty === level).map((row) => row.score.core_score)))]))]));
const pairwiseResults = { schema_version: 2, status: 'completed', full_omni_vs_no_memory: pairwise(full, noMemory), full_omni_vs_retrieval_only: pairwise(full, retrieval) };
await writeJson(path.join(EVIDENCE, 'pairwise-results-v2.1.json'), pairwiseResults);

const reviewFlags = Object.fromEntries(['score_issue', 'gold_ambiguity', 'baseline_fairness_issue', 'memory_leakage_issue', 'judge_reliability_issue', 'provenance_issue', 'invalidated_fact_rejection_issue', 'temporal_transition_issue'].map((key) => [key, review.reviews.filter((row) => row.agent_review[key]).length]));
const analysis = {
  schema_version: 1,
  status: 'DEVELOPMENT_FINAL_NOT_FORMAL',
  judge_adapter_version: config.primary_judge.adapter_version,
  judge_rubric_version: config.primary_judge.rubric_version,
  completion: { full_omni: `${full.length}/35`, no_memory: `${noMemory.length}/21`, retrieval_only: `${retrieval.length}/21`, secondary_agent_review: `${review.count}/20` },
  metrics: byMode,
  difficulty_scores: difficulty,
  pairwise: { full_omni_vs_no_memory: { ...pairwiseResults.full_omni_vs_no_memory, pairs: undefined }, full_omni_vs_retrieval_only: { ...pairwiseResults.full_omni_vs_retrieval_only, pairs: undefined } },
  kimi_reliability: { logical_judge_calls: ledger.logical_judge_calls, physical_attempts: ledger.physical_attempts, successful_logical_calls: ledger.successful_logical_calls, truncated_attempts: ledger.truncated_attempts, malformed_attempts: ledger.malformed_attempts, schema_validation_failures: ledger.schema_validation_failures, retries_recovered: ledger.retries_recovered, schema_recovery_rate: ledger.schema_failures ? round(ledger.retries_recovered / ledger.schema_failures) : 1, provider_errors: ledger.errors, fallbacks: ledger.structured_output_fallbacks },
  secondary_review: { count: review.count, human_review_completed: false, flags: reviewFlags },
};
await writeJson(path.join(EVIDENCE, 'development-analysis-v2.1.json'), analysis);

const answerTokens = tokenTotals(all, 'answer');
const reviewTokens = review.reviews.reduce((total, row) => {
  for (const key of Object.keys(total)) total[key] += row.usage?.[key] || 0;
  return total;
}, { input_tokens: 0, output_tokens: 0, cache_hit_input_tokens: 0, cache_miss_input_tokens: 0, total_tokens: 0, cached_tokens: 0 });
const answerAvg = { input: answerTokens.input_tokens / all.length, output: answerTokens.output_tokens / all.length, cache_hit: answerTokens.cache_hit_input_tokens / all.length, cache_miss: answerTokens.cache_miss_input_tokens / all.length };
const fullLatencies = full.map((row) => row.latency_ms?.total).filter(Number.isFinite);
const formalAnswerTokens = { cache_hit_input_tokens: answerAvg.cache_hit * 250, cache_miss_input_tokens: answerAvg.cache_miss * 250, output_tokens: answerAvg.output * 250 };
const formalJudgeLogicalCalls = 60;
const judgeInputAvg = ledger.prompt_tokens / ledger.successful_logical_calls;
const judgeOutputAvg = ledger.completion_tokens / ledger.successful_logical_calls;
const costEstimate = {
  schema_version: 2,
  status: 'PRE_FORMAL_PARTIAL_COST_ESTIMATE_FROM_FINAL_DEVELOPMENT',
  actual_development: { deepseek_answer_tokens: answerTokens, deepseek_secondary_review_tokens: reviewTokens, kimi_judge_tokens: { prompt_tokens: ledger.prompt_tokens, completion_tokens: ledger.completion_tokens, total_tokens: ledger.total_tokens, cached_tokens: ledger.cached_tokens }, deepseek_observable_cost_usd: round(cost(answerTokens, config.pricing_usd_per_million_tokens) + cost(reviewTokens, config.pricing_usd_per_million_tokens), 4), kimi_cost_usd: null, kimi_cost_reason: 'No verified kimi-k2.6 per-token price is pinned in benchmark configuration.' },
  formal_250_estimate: { answer_calls: 250, kimi_logical_judge_calls: formalJudgeLogicalCalls, projected_deepseek_answer_tokens: { input_tokens: Math.round(answerAvg.input * 250), output_tokens: Math.round(answerAvg.output * 250) }, projected_kimi_tokens: { prompt_tokens: Math.round(judgeInputAvg * formalJudgeLogicalCalls), completion_tokens: Math.round(judgeOutputAvg * formalJudgeLogicalCalls) }, projected_deepseek_answer_cost_usd: round(cost(formalAnswerTokens, config.pricing_usd_per_million_tokens), 4), projected_kimi_cost_usd: null, extraction_cost_excluded: true, estimated_runtime_hours: round(avg(fullLatencies) * 250 / 3_600_000, 2) },
  latency_ms: { full_omni_p50: round(percentile(fullLatencies, 0.5), 1), full_omni_p95: round(percentile(fullLatencies, 0.95), 1), full_omni_mean: round(avg(fullLatencies), 1), kimi_attempt_p50: round(percentile(ledger.attempts.map((entry) => new Date(entry.completed_at) - new Date(entry.started_at)).filter(Number.isFinite), 0.5), 1), kimi_attempt_p95: round(percentile(ledger.attempts.map((entry) => new Date(entry.completed_at) - new Date(entry.started_at)).filter(Number.isFinite), 0.95), 1) },
  caveats: ['Kimi K2.6 dollar cost is not estimated without a pinned verified price.', 'Frozen Brain Server extraction does not expose complete provider token usage, so extraction cost is excluded.', 'Runtime is a linear Development-based estimate, not a Formal observation.'],
};
await writeJson(path.join(EVIDENCE, 'cost-estimate-v2.1.json'), costEstimate);

const unresolvedP0 = [];
if (full.length !== 35 || noMemory.length !== 21 || retrieval.length !== 21 || review.count !== 20 || ledger.successful_logical_calls !== ledger.logical_judge_calls) unresolvedP0.push('Completion gate mismatch');
const unresolvedP1 = [];
if (byMode.retrieval_only.overall_cognitive_score > byMode.full_omni.overall_cognitive_score) unresolvedP1.push('Retrieval-Only scored above Full Omni and requires product-level interpretation before Formal freeze.');
if (byMode.full_omni.by_category.cross_agent_transfer.metrics.provenance_preservation === 0) unresolvedP1.push('Full Omni Cross-Agent Provenance is 0.');
if (byMode.full_omni.by_category.conflict_resolution.metrics.invalidated_fact_rejection === 0) unresolvedP1.push('Full Omni Invalidated Fact Rejection is 0.');
if (reviewFlags.score_issue > 0) unresolvedP1.push(`Secondary Agent Review flagged score issues in ${reviewFlags.score_issue}/${review.count} reviewed records.`);
await writeJson(path.join(EVIDENCE, 'final-review-status-v2.1.json'), { schema_version: 2, status: unresolvedP0.length ? 'COGNITIVE BENCHMARK V1.1 NOT READY' : 'COGNITIVE BENCHMARK V1.1 READY FOR FINAL REVIEW', completion: analysis.completion, unresolved_p0: unresolvedP0, unresolved_p1: unresolvedP1, formal_draft: 'DRAFT_NOT_FROZEN', formal_250_started: false, comparison_started: false, locomo_conversations_2_to_10_accessed: false, final_freeze_modified: false, api_key_recorded: false });

const files = (await walk(EVIDENCE)).filter((file) => !file.endsWith('hash-draft-v2.1.json'));
await writeJson(path.join(EVIDENCE, 'hash-draft-v2.1.json'), { schema_version: 2, status: 'DRAFT_EVIDENCE_HASHES', algorithm: 'sha256', files: Object.fromEntries((await Promise.all(files.map(async (file) => [path.relative(EVIDENCE, file).replaceAll('\\', '/'), createHash('sha256').update(await readFile(file)).digest('hex')]))).sort(([a], [b]) => a.localeCompare(b))) });

console.log(JSON.stringify({ completion: analysis.completion, scores: Object.fromEntries(Object.entries(byMode).map(([mode, metrics]) => [mode, metrics.overall_cognitive_score])), kimi: analysis.kimi_reliability, secondary_review_flags: reviewFlags, unresolved_p0: unresolvedP0.length, unresolved_p1: unresolvedP1.length }));
