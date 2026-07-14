#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { duplicateAudit, familyAudit, difficultyAudit, leakageAudit, formalDiversityAudit } from './audits.mjs';
import { CATEGORY_KEYS, CATEGORY_SPECS } from './constants.mjs';
import { CognitiveProvider } from './provider.mjs';
import { aggregateResults, scoreScenario } from './scoring.mjs';
import { ANSWER_SCHEMA_V2, KIMI_JUDGE_SCHEMA_V2 } from './schemas.mjs';
import { generateSplit, selectComparisonSubset } from './scenarios.mjs';
import { clearShutdown, computeMetricsFile, readJsonl, requestShutdown, runCalibration, writeJson, writeJsonl } from './runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..', '..');
const DEFAULT_EVIDENCE = path.join(REPO, 'docs', 'cognitive-benchmark-v1.1-review', 'evidence');
const command = process.argv[2];
const flag = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };

process.on('SIGINT', requestShutdown);
process.on('SIGTERM', requestShutdown);

async function loadConfig() {
  const file = path.resolve(flag('--config', path.join(ROOT, 'config', 'default.json')));
  const config = JSON.parse(await readFile(file, 'utf8'));
  if (process.argv.includes('--max-retries')) config.max_retries = Number(flag('--max-retries', String(config.max_retries)));
  return config;
}

async function loadProvider(config, runRoot, kimiUsagePath) {
  const [answerPrompt, judgePrompt, reviewPrompt] = await Promise.all([
    readFile(path.join(ROOT, 'prompts', 'answer-v2.txt'), 'utf8'),
    readFile(path.join(ROOT, 'prompts', 'judge-v2-kimi.txt'), 'utf8'),
    readFile(path.join(ROOT, 'prompts', 'agent-review-v1.txt'), 'utf8'),
  ]);
  return new CognitiveProvider({ config, answerPrompt, judgePrompt, reviewPrompt, runRoot, brainServerRoot: path.join(REPO, 'brain-server'), kimiUsagePath });
}

if (command === 'generate') {
  const out = path.resolve(flag('--out', DEFAULT_EVIDENCE));
  await mkdir(path.join(out, 'prompts'), { recursive: true });
  const smoke = generateSplit('smoke');
  const development = generateSplit('development');
  const formal = generateSplit('formal');
  const comparison = selectComparisonSubset(formal);
  const [answerPrompt, judgePrompt, reviewPrompt, config] = await Promise.all([
    readFile(path.join(ROOT, 'prompts', 'answer-v2.txt'), 'utf8'),
    readFile(path.join(ROOT, 'prompts', 'judge-v2-kimi.txt'), 'utf8'),
    readFile(path.join(ROOT, 'prompts', 'agent-review-v1.txt'), 'utf8'),
    loadConfig(),
  ]);
  const duplicate = duplicateAudit(formal);
  const family = familyAudit(formal, development);
  const difficulty = difficultyAudit(formal);
  const leakage = leakageAudit({ formal, answerPrompt, judgePrompt, comparisonIds: comparison });
  const diversity = formalDiversityAudit(formal, family, difficulty, duplicate, leakage);
  await Promise.all([
    writeJsonl(path.join(out, 'smoke-dataset-v2.jsonl'), smoke),
    writeJsonl(path.join(out, 'development-dataset-v2.jsonl'), development),
    writeJsonl(path.join(out, 'formal-dataset-draft-v2.jsonl'), formal),
    writeJson(path.join(out, 'comparison-subset-draft-v2.json'), { schema_version: 2, status: 'DRAFT_NOT_RUN', preselected_before_formal_run: true, selection: '3 easy + 5 medium + 2 hard per category', scenario_ids: comparison }),
    writeJson(path.join(out, 'answer-schema-v2.json'), ANSWER_SCHEMA_V2),
    writeJson(path.join(out, 'kimi-judge-schema-v2.json'), KIMI_JUDGE_SCHEMA_V2),
    writeJson(path.join(out, 'duplicate-audit.json'), duplicate),
    writeJson(path.join(out, 'family-distribution.json'), family),
    writeJson(path.join(out, 'difficulty-validation.json'), difficulty),
    writeJson(path.join(out, 'leakage-audit.json'), leakage),
    writeJson(path.join(out, 'formal-diversity-audit.json'), diversity),
    writeJson(path.join(out, 'config-v1.1.json'), config),
    writeFile(path.join(out, 'prompts', 'answer-v2.txt'), answerPrompt),
    writeFile(path.join(out, 'prompts', 'judge-v2-kimi.txt'), judgePrompt),
    writeFile(path.join(out, 'prompts', 'agent-review-v1.txt'), reviewPrompt),
  ]);
  await writeJson(path.join(out, 'dataset-manifest-draft-v2.json'), {
    schema_version: 2,
    seed: config.seed,
    smoke: { count: smoke.length, status: 'CALIBRATION_ONLY' },
    development: { count: development.length, status: 'DEVELOPMENT_ONLY', families_per_category: Object.fromEntries(CATEGORY_KEYS.map((category) => [category, new Set(development.filter((scenario) => scenario.category === category).map((scenario) => scenario.scenario_family)).size])) },
    formal: { count: formal.length, status: 'DRAFT_NOT_FROZEN', by_category: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, CATEGORY_SPECS[key].formal_count])) },
    comparison: { count: comparison.length, status: 'DRAFT_NOT_RUN' },
    audits: { duplicate: duplicate.status, family: family.status, difficulty: difficulty.status, leakage: leakage.status, diversity: diversity.status },
    official_locomo: false,
    conversation_2_to_10_accessed: false,
  });
  console.log(JSON.stringify({ smoke: smoke.length, development: development.length, formal_draft_v2: formal.length, comparison_draft_v2: comparison.length, audits: { duplicate: duplicate.status, family: family.status, difficulty: difficulty.status, leakage: leakage.status, diversity: diversity.status } }));
} else if (command === 'preflight-kimi') {
  const output = path.resolve(flag('--output', path.join(DEFAULT_EVIDENCE, 'kimi-preflight-results.json')));
  const usage = path.resolve(flag('--kimi-usage', path.join(DEFAULT_EVIDENCE, 'kimi-usage.json')));
  const config = await loadConfig();
  const provider = await loadProvider(config, path.resolve(flag('--run-root', 'D:/OmniContext-cognitive-v1.1/kimi-preflight')), usage);
  const fixtures = [
    { id: 'high_quality', answer: { answer: 'The evidence shows project overload; pause the third project and run two user interviews within the five-hour limit.', insights: ['project overload', 'lack of validation'], actions: ['pause the third project', 'two interviews'], uncertainty: null } },
    { id: 'partial', answer: { answer: 'Focus more.', insights: ['too many projects'], actions: [], uncertainty: 'Priorities are unclear.' } },
    { id: 'overreach', answer: { answer: 'The user has ADHD and must quit work immediately.', insights: ['ADHD'], actions: ['quit immediately'], uncertainty: null } },
  ];
  const scenario = { scenario_id: 'kimi-preflight', category: 'proactive_insight', question: 'Identify an evidence-backed blind spot and bounded action.', gold: { acceptable_insights: ['project overload', 'lack of validation'], acceptable_actions: ['pause a project', 'conduct interviews'], forbidden_inferences: ['ADHD', 'mental illness'], unacceptable_actions: ['quit immediately'], required_constraints: ['five hours'] } };
  const results = [];
  let preflightError = null;
  for (const fixture of fixtures) {
    try {
      const result = await provider.judge({ scenario: { ...scenario, scenario_id: `kimi-preflight-${fixture.id}` }, answer: fixture.answer, context: [{ source_id: 'p1', text: 'Three concurrent projects, no interviews, five hours weekly.', source_agents: ['Agent-A'] }] });
      results.push({ fixture: fixture.id, status: 'completed', model: result.model, structured: result.structured, raw_response: result.raw, usage: result.usage, latency_ms: result.latency_ms, structured_output_fallback: result.structured_output_fallback, fallback_reason: result.fallback_reason });
    } catch (error) {
      preflightError = error;
      results.push({ fixture: fixture.id, status: 'blocked', error: error.message });
      break;
    }
  }
  const status = preflightError ? 'blocked' : results.length === 3 ? 'completed' : 'partial';
  await writeJson(output, { schema_version: 1, status, expected_model: 'kimi-k2.6', thinking: 'disabled', temperature: config.primary_judge.temperature, schema_valid: !preflightError, completed_fixtures: results.filter((result) => result.status === 'completed').length, results, api_key_recorded: false, formal_run_started: false });
  console.log(JSON.stringify({ status, completed: results.filter((result) => result.status === 'completed').length, model: results.find((result) => result.model)?.model || null, fallbacks: results.filter((result) => result.structured_output_fallback).length, error: preflightError?.message || null }));
} else if (['run', 'resume', 'retry-errors'].includes(command)) {
  const datasetPath = path.resolve(flag('--dataset'));
  const resultsPath = path.resolve(flag('--results'));
  const checkpointPath = path.resolve(flag('--checkpoint'));
  const manifestPath = path.resolve(flag('--manifest'));
  const config = await loadConfig();
  const scenarios = await readJsonl(datasetPath);
  const modes = flag('--modes', 'full_omni').split(',');
  const limit = Number(flag('--limit', '0'));
  const selected = limit > 0 ? CATEGORY_KEYS.flatMap((category) => scenarios.filter((scenario) => scenario.category === category).slice(0, Math.ceil(limit / 7))).slice(0, limit) : scenarios;
  const backend = flag('--backend', 'synthetic_calibration');
  const runRoot = path.resolve(flag('--run-root', 'D:/OmniContext-cognitive-v1.1/runs'));
  const kimiUsage = path.resolve(flag('--kimi-usage', path.join(DEFAULT_EVIDENCE, 'kimi-usage.json')));
  const provider = await loadProvider(config, runRoot, kimiUsage);
  clearShutdown();
  await mkdir(path.dirname(resultsPath), { recursive: true });
  const result = await runCalibration({ scenarios, modes, provider, resultsPath, checkpointPath, manifestPath, config, split: selected[0]?.split, backend, stopAfter: Number(flag('--stop-after', '0')) || null, injectInterruptAfter: Number(flag('--inject-interrupt-after', '0')) || null, injectErrorOnce: flag('--inject-error-once', null), retryErrorsOnly: command === 'retry-errors', selectedScenarios: selected, logger: console.log });
  console.log(JSON.stringify(result.manifest));
} else if (command === 'metrics') {
  const metrics = await computeMetricsFile(path.resolve(flag('--results')), path.resolve(flag('--output')));
  console.log(JSON.stringify({ completed: metrics.completed, overall: metrics.overall_cognitive_score }));
} else if (command === 'review') {
  const config = await loadConfig();
  const scenarios = await readJsonl(path.resolve(flag('--dataset')));
  const full = (await readJsonl(path.resolve(flag('--results')))).filter((record) => record.status === 'completed');
  const baseline = (await readJsonl(path.resolve(flag('--baseline-results')))).filter((record) => record.status === 'completed');
  const byId = new Map(scenarios.map((scenario) => [scenario.scenario_id, scenario]));
  const sorted = [...full].sort((a, b) => a.score.core_score - b.score.core_score || a.scenario_id.localeCompare(b.scenario_id));
  const chosen = [];
  const add = (record, stratum) => { const key = `${record.scenario_id}:${record.mode}`; if (!chosen.some((item) => item.key === key)) chosen.push({ key, record, stratum }); };
  sorted.slice(0, 5).forEach((record) => add(record, 'low'));
  sorted.slice(Math.max(0, Math.floor(sorted.length / 2) - 2), Math.floor(sorted.length / 2) + 3).forEach((record) => add(record, 'medium'));
  sorted.slice(-5).forEach((record) => add(record, 'high'));
  const fullById = new Map(full.map((record) => [record.scenario_id, record]));
  [...baseline].sort((a, b) => Math.abs((fullById.get(b.scenario_id)?.score.core_score || 0) - b.score.core_score) - Math.abs((fullById.get(a.scenario_id)?.score.core_score || 0) - a.score.core_score)).slice(0, 12).forEach((record) => { if (chosen.length < 20) add(record, 'baseline_or_disputed'); });
  if (chosen.length !== 20) throw new Error(`Stratified review selection produced ${chosen.length}, expected 20`);
  const provider = await loadProvider(config, path.resolve(flag('--run-root', 'D:/OmniContext-cognitive-v1.1/review')), path.resolve(flag('--kimi-usage', path.join(DEFAULT_EVIDENCE, 'kimi-usage.json'))));
  const reviews = [];
  for (const selection of chosen) {
    const record = selection.record;
    const result = await provider.agentReview({ scenario_id: record.scenario_id, category: record.category, difficulty: record.difficulty, scenario_family: byId.get(record.scenario_id)?.scenario_family, review_stratum: selection.stratum, question: record.question, gold: byId.get(record.scenario_id)?.gold, mode: record.mode, visible_context: record.visible_context, structured_answer: record.structured_answer, primary_judge: record.structured_judge, computed_score_v3: record.score });
    reviews.push({ schema_version: 2, scenario_id: record.scenario_id, mode: record.mode, stratum: selection.stratum, agent_review: result.structured, raw_response: result.raw, model: result.model, usage: result.usage, latency_ms: result.latency_ms, secondary_review_independent: false, human_review: false, reviewed_at: new Date().toISOString() });
    console.log(`reviewed ${selection.stratum} ${record.scenario_id}:${record.mode}`);
  }
  await writeJson(path.resolve(flag('--output')), { schema_version: 2, review_type: 'secondary_agent_review_not_human', secondary_review_independent: false, human_review_completed: false, selection_after_final_scoring: true, count: reviews.length, strata: Object.fromEntries(['low', 'medium', 'high', 'baseline_or_disputed'].map((stratum) => [stratum, reviews.filter((review) => review.stratum === stratum).length])), reviews });
  console.log(JSON.stringify({ reviewed: reviews.length }));
} else if (command === 'rescore') {
  const scenarios = await readJsonl(path.resolve(flag('--dataset')));
  const resultsPath = path.resolve(flag('--results'));
  const output = path.resolve(flag('--output', resultsPath));
  const byId = new Map(scenarios.map((scenario) => [scenario.scenario_id, scenario]));
  const records = await readJsonl(resultsPath);
  const rescored = records.map((record) => {
    if (record.status !== 'completed') return record;
    const scenario = byId.get(record.scenario_id);
    const next = scoreScenario({ scenario, answer: record.structured_answer, visibleSourceIds: (record.visible_context || []).map((item) => item.source_id), visibleAgents: [...new Set((record.visible_context || []).flatMap((item) => item.source_agents || []))], judge: record.structured_judge, mode: record.mode });
    return { ...record, score_pre_v3_rescore: record.score, score: next, scoring_version: 'deterministic-scoring-v3', rescored_at: new Date().toISOString() };
  });
  await writeJsonl(output, rescored);
  console.log(JSON.stringify({ rescored: rescored.filter((record) => record.status === 'completed').length }));
} else if (command === 'aggregate') {
  const rows = (await Promise.all(flag('--results').split(',').map((file) => readJsonl(path.resolve(file))))).flat();
  const byMode = Object.fromEntries(['no_memory', 'retrieval_only', 'full_omni'].map((mode) => [mode, aggregateResults(rows.filter((record) => record.mode === mode))]));
  await writeJson(path.resolve(flag('--output')), { schema_version: 2, status: 'DEVELOPMENT_RESULTS_NOT_FORMAL', answer_schema_version: 'answer-schema-v2', scoring_version: 'deterministic-scoring-v3', primary_judge: 'kimi-k2.6', primary_judge_independent: true, by_mode: byMode });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(byMode).map(([mode, metrics]) => [mode, metrics.overall_cognitive_score]))));
} else {
  throw new Error('Commands: generate | preflight-kimi | run | resume | retry-errors | metrics | review | rescore | aggregate');
}
