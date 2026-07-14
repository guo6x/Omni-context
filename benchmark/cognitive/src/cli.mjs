#!/usr/bin/env node
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORY_KEYS, CATEGORY_SPECS } from './constants.mjs';
import { generateSplit, selectComparisonSubset } from './scenarios.mjs';
import { CognitiveProvider } from './provider.mjs';
import { scoreScenario } from './scoring.mjs';
import { clearShutdown, computeMetricsFile, readJsonl, requestShutdown, runCalibration, writeJson, writeJsonl } from './runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..', '..');
const command = process.argv[2];
const flag = (name, fallback) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };

process.on('SIGINT', requestShutdown);
process.on('SIGTERM', requestShutdown);

async function loadProvider(config, runRoot) {
  const [answerPrompt, judgePrompt, reviewPrompt] = await Promise.all([
    readFile(path.join(ROOT, 'prompts', 'answer-v1.txt'), 'utf8'),
    readFile(path.join(ROOT, 'prompts', 'judge-v1.txt'), 'utf8'),
    readFile(path.join(ROOT, 'prompts', 'agent-review-v1.txt'), 'utf8'),
  ]);
  return new CognitiveProvider({ config, answerPrompt, judgePrompt, reviewPrompt, runRoot, brainServerRoot: path.join(REPO, 'brain-server') });
}

if (command === 'generate') {
  const out = path.resolve(flag('--out', path.join(REPO, 'docs', 'cognitive-benchmark-v1-review', 'evidence')));
  await mkdir(out, { recursive: true });
  const smoke = generateSplit('smoke');
  const development = generateSplit('development');
  const formal = generateSplit('formal');
  const comparison = selectComparisonSubset(formal);
  await writeJsonl(path.join(out, 'smoke-dataset.jsonl'), smoke);
  await writeJsonl(path.join(out, 'development-dataset.jsonl'), development);
  await writeJsonl(path.join(out, 'formal-dataset-draft.jsonl'), formal);
  await writeJson(path.join(out, 'comparison-subset-draft.json'), { schema_version: 1, status: 'DRAFT_NOT_RUN', preselected_before_formal_run: true, scenario_ids: comparison });
  const difficulty = Object.fromEntries(CATEGORY_KEYS.map((category) => [category, Object.fromEntries(['easy', 'medium', 'hard'].map((level) => [level, formal.filter((s) => s.category === category && s.difficulty === level).length]))]));
  await writeJson(path.join(out, 'dataset-manifest-draft.json'), {
    schema_version: 1,
    seed: 20260714,
    smoke: { count: smoke.length, status: 'CALIBRATION_ONLY' },
    development: { count: development.length, status: 'DEVELOPMENT_ONLY' },
    formal: { count: formal.length, status: 'DRAFT_NOT_FROZEN', by_category: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, CATEGORY_SPECS[key].formal_count])), difficulty },
    comparison: { count: comparison.length, status: 'DRAFT_NOT_RUN' },
    official_locomo: false,
    conversation_2_to_10_accessed: false,
  });
  console.log(JSON.stringify({ smoke: smoke.length, development: development.length, formal_draft: formal.length, comparison_draft: comparison.length }));
} else if (['run', 'resume', 'retry-errors'].includes(command)) {
  const datasetPath = path.resolve(flag('--dataset'));
  const resultsPath = path.resolve(flag('--results'));
  const checkpointPath = path.resolve(flag('--checkpoint'));
  const manifestPath = path.resolve(flag('--manifest'));
  const configPath = path.resolve(flag('--config', path.join(ROOT, 'config', 'default.json')));
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (process.argv.includes('--max-retries')) config.max_retries = Number(flag('--max-retries', String(config.max_retries)));
  const scenarios = await readJsonl(datasetPath);
  const modes = flag('--modes', 'full_omni').split(',');
  const limit = Number(flag('--limit', '0'));
  const selected = limit > 0 ? CATEGORY_KEYS.flatMap((category) => scenarios.filter((s) => s.category === category).slice(0, Math.ceil(limit / 7))).slice(0, limit) : scenarios;
  const backend = flag('--backend', 'synthetic_calibration');
  const runRoot = path.resolve(flag('--run-root', 'D:/OmniContext-cognitive-v1/runs'));
  const provider = await loadProvider(config, runRoot);
  clearShutdown();
  await mkdir(path.dirname(resultsPath), { recursive: true });
  const result = await runCalibration({
    scenarios,
    modes,
    provider,
    resultsPath,
    checkpointPath,
    manifestPath,
    config,
    split: selected[0]?.split,
    backend,
    stopAfter: Number(flag('--stop-after', '0')) || null,
    injectInterruptAfter: Number(flag('--inject-interrupt-after', '0')) || null,
    injectErrorOnce: flag('--inject-error-once', null),
    retryErrorsOnly: command === 'retry-errors',
    selectedScenarios: selected,
    logger: console.log,
  });
  console.log(JSON.stringify(result.manifest));
} else if (command === 'metrics') {
  const metrics = await computeMetricsFile(path.resolve(flag('--results')), path.resolve(flag('--output')));
  console.log(JSON.stringify({ completed: metrics.completed, overall: metrics.overall_cognitive_score }));
} else if (command === 'review') {
  const configPath = path.resolve(flag('--config', path.join(ROOT, 'config', 'default.json')));
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const scenarios = await readJsonl(path.resolve(flag('--dataset')));
  const records = await readJsonl(path.resolve(flag('--results')));
  const output = path.resolve(flag('--output'));
  const limit = Number(flag('--limit', '20'));
  const byId = new Map(scenarios.map((scenario) => [scenario.scenario_id, scenario]));
  const completed = records.filter((record) => record.status === 'completed');
  const selected = CATEGORY_KEYS.flatMap((category) => completed.filter((record) => record.category === category).slice(0, 3)).slice(0, limit);
  const provider = await loadProvider(config, path.resolve(flag('--run-root', 'D:/OmniContext-cognitive-v1/review')));
  const reviews = [];
  for (const record of selected) {
    const scenario = byId.get(record.scenario_id);
    const result = await provider.agentReview({
      scenario_id: record.scenario_id,
      category: record.category,
      difficulty: record.difficulty,
      question: record.question,
      gold: scenario?.gold,
      mode: record.mode,
      visible_context: record.visible_context,
      structured_answer: record.structured_answer,
      computed_score: record.score,
    });
    reviews.push({ schema_version: 1, scenario_id: record.scenario_id, mode: record.mode, agent_review: result.structured, raw_response: result.raw, model: result.model, usage: result.usage, latency_ms: result.latency_ms, judge_independent: false, reviewed_at: new Date().toISOString() });
    console.log(`reviewed ${record.scenario_id}`);
  }
  await writeJson(output, { schema_version: 1, review_type: 'agent_review_not_human', judge_independent: false, count: reviews.length, reviews });
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
    if (!scenario) throw new Error(`Cannot rescore missing scenario ${record.scenario_id}`);
    const next = scoreScenario({ scenario, answer: record.structured_answer, visibleSourceIds: (record.visible_context || []).map((item) => item.source_id), judge: record.structured_judge });
    return { ...record, score_pre_calibration: record.score, score: { ...next, calibration_version: 'deterministic-scoring-v2' }, rescored_at: new Date().toISOString() };
  });
  await writeJsonl(output, rescored);
  console.log(JSON.stringify({ rescored: rescored.filter((record) => record.status === 'completed').length, output }));
} else {
  throw new Error('Commands: generate | run | resume | retry-errors | metrics | review | rescore');
}
