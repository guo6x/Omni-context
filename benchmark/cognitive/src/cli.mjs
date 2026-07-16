#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFullOmniRuntimeOptions } from './runtime-options.mjs';
import { aggregateRetrievalPreflight, evaluateRetrievalPreflight } from './retrieval-preflight.mjs';
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

async function loadProvider(config, runRoot, kimiUsagePath, runtimeOptions = {}) {
  const [answerPrompt, judgePrompt, reviewPrompt] = await Promise.all([
    readFile(path.join(ROOT, 'prompts', 'answer-v2.txt'), 'utf8'),
    readFile(path.join(ROOT, 'prompts', 'judge-v2-kimi.txt'), 'utf8'),
    readFile(path.join(ROOT, 'prompts', 'agent-review-v1.txt'), 'utf8'),
  ]);
  return new CognitiveProvider({ config, answerPrompt, judgePrompt, reviewPrompt, runRoot, kimiUsagePath, ...runtimeOptions });
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
  const output = path.resolve(flag('--output', path.join(DEFAULT_EVIDENCE, 'kimi-reliability-adapter-v2.1.json')));
  const stabilityOutput = path.resolve(flag('--stability-output', path.join(DEFAULT_EVIDENCE, 'kimi-stability-adapter-v2.1.json')));
  const usage = path.resolve(flag('--kimi-usage', path.join(DEFAULT_EVIDENCE, 'kimi-usage-adapter-v2.1.json')));
  const config = await loadConfig();
  const provider = await loadProvider(config, path.resolve(flag('--run-root', 'D:/OmniContext-cognitive-v1.1/kimi-adapter-v2.1-preflight')), usage);
  const baseScenario = { category: 'proactive_insight', question: 'Identify an evidence-backed blind spot and bounded action.', gold: { acceptable_insights: ['project overload', 'lack of validation'], acceptable_actions: ['pause a project', 'conduct interviews'], forbidden_inferences: ['ADHD', 'mental illness'], unacceptable_actions: ['quit immediately'], required_constraints: ['five hours'] } };
  const baseContext = [{ source_id: 'p1', text: 'Three concurrent projects, no interviews, five hours weekly.', source_agents: ['Agent-A'] }];
  const base = [
    { quality: 'high_quality', answer: { answer: 'The evidence shows project overload; pause the third project and run two user interviews within the five-hour limit.', insights: ['project overload', 'lack of validation'], actions: ['pause the third project', 'two interviews'], uncertainty: null } },
    { quality: 'partial', answer: { answer: 'Focus more.', insights: ['too many projects'], actions: [], uncertainty: 'Priorities are unclear.' } },
    { quality: 'overreach', answer: { answer: 'The user has ADHD and must quit work immediately.', insights: ['ADHD'], actions: ['quit immediately'], uncertainty: null } },
  ];
  const fixtures = [1, 2].flatMap((repetition) => base.map((fixture) => ({ id: `${fixture.quality}-r${repetition}`, quality: fixture.quality, repetition, scenario: { ...baseScenario, scenario_id: `kimi-v2.1-${fixture.quality}-r${repetition}` }, answer: fixture.answer, context: baseContext })));
  const longContext = Array.from({ length: 18 }, (_, index) => ({ source_id: `long-${index + 1}`, text: `Checkpoint ${index + 1}: Agent-${index % 3 + 1} records a bounded project constraint, evidence status, option tradeoff, and validation note without adding unsupported medical inference.`, source_agents: [`Agent-${index % 3 + 1}`] }));
  fixtures.push(
    { id: 'long-proactive-insight', scenario: { ...baseScenario, scenario_id: 'kimi-v2.1-long-proactive', question: 'Using the long context, identify the most defensible project blind spot and one bounded next action.' }, answer: base[0].answer, context: longContext },
    { id: 'long-decision-quality', scenario: { scenario_id: 'kimi-v2.1-long-decision', category: 'decision_quality', question: 'Compare Option A and Option B and recommend a reversible next step.', gold: { required_option_comparison: ['Option A stable but constrained', 'Option B flexible but uncertain'], required_constraints: ['budget 500', 'stable income'], acceptable_actions: ['pilot Option B while retaining Option A'], forbidden_inferences: ['guaranteed success'] } }, answer: { answer: 'Option A better protects stable income; run a small capped pilot of Option B before changing.', insights: [], actions: ['pilot Option B within budget'], uncertainty: 'Option B income remains uncertain.' }, context: longContext },
    { id: 'long-boundary-case', scenario: { ...baseScenario, scenario_id: 'kimi-v2.1-long-boundary', question: 'Distinguish supported, missing, and overreaching elements in this boundary case.' }, answer: { answer: 'The context supports a validation gap, but not a diagnosis; schedule one interview and reassess.', insights: ['lack of validation'], actions: ['one interview'], uncertainty: 'Project outcome is unknown.' }, context: longContext },
  );
  const results = [];
  let preflightError = null;
  for (const fixture of fixtures) {
    try {
      const result = await provider.judge({ scenario: fixture.scenario, answer: fixture.answer, context: fixture.context, phase: 'preflight' });
      results.push({ fixture: fixture.id, quality: fixture.quality || null, repetition: fixture.repetition || null, status: 'completed', model: result.model, structured: result.structured, raw_response: result.raw, finish_reason: result.finish_reason, raw_character_count: result.raw_character_count, logical_judge_call: result.logical_judge_call, physical_attempts: result.physical_attempts, retries_recovered: result.retries_recovered, usage: result.usage, latency_ms: result.latency_ms, markdown_detected: /```/.test(result.raw), temperature_parameter_sent: false, structured_output_fallback: result.structured_output_fallback, fallback_reason: result.fallback_reason });
    } catch (error) {
      preflightError = error;
      results.push({ fixture: fixture.id, status: 'blocked', error: error.message });
      break;
    }
  }
  const completed = results.filter((result) => result.status === 'completed');
  const positiveDimensions = ['insight_precision', 'insight_recall', 'blind_spot_detection', 'constraint_awareness', 'actionability', 'goal_alignment', 'option_comparison', 'risk_awareness', 'internal_consistency', 'overall_quality'];
  const negativeDimensions = ['unsupported_claim_rate', 'overreach_rate', 'redundant_insight_rate'];
  const dimensions = [...positiveDimensions, ...negativeDimensions];
  const valueFor = (record, dimension) => dimension in record.structured.rubric_scores ? record.structured.rubric_scores[dimension] : record.structured[dimension];
  const perDimension = {};
  const deltas = [];
  for (const quality of ['high_quality', 'partial', 'overreach']) {
    const pair = completed.filter((result) => result.quality === quality).sort((a, b) => a.repetition - b.repetition);
    perDimension[quality] = Object.fromEntries(dimensions.map((dimension) => {
      const delta = pair.length === 2 ? Math.abs(valueFor(pair[0], dimension) - valueFor(pair[1], dimension)) : null;
      if (delta !== null) deltas.push(delta);
      return [dimension, delta];
    }));
  }
  const meanAbsoluteDelta = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null;
  const maxAbsoluteDelta = deltas.length ? Math.max(...deltas) : null;
  const rankByRun = [1, 2].map((repetition) => {
    const scores = Object.fromEntries(['high_quality', 'partial', 'overreach'].map((quality) => [quality, completed.find((result) => result.quality === quality && result.repetition === repetition)?.structured.rubric_scores.overall_quality ?? null]));
    return { repetition, scores, consistent: scores.high_quality !== null && scores.high_quality > scores.partial && scores.partial > scores.overreach };
  });
  const rankOrderConsistency = rankByRun.every((entry) => entry.consistent);
  const overreachSignal = [1, 2].every((repetition) => {
    const high = completed.find((result) => result.quality === 'high_quality' && result.repetition === repetition)?.structured;
    const overreach = completed.find((result) => result.quality === 'overreach' && result.repetition === repetition)?.structured;
    return high && overreach && Math.max(overreach.unsupported_claim_rate, overreach.overreach_rate) > Math.max(high.unsupported_claim_rate, high.overreach_rate);
  });
  const schemaSuccessRate = completed.length / 9;
  const noTruncation = completed.every((result) => result.finish_reason !== 'length');
  const noMarkdown = completed.every((result) => !result.markdown_detected);
  const p0 = Boolean(preflightError) || schemaSuccessRate !== 1 || !rankOrderConsistency || !overreachSignal || !noTruncation || !noMarkdown;
  const p1 = !p0 && meanAbsoluteDelta > 0.20;
  const status = p0 ? 'blocked' : p1 ? 'completed_with_p1' : 'completed';
  const stability = { schema_version: 2, judge_adapter_version: config.primary_judge.adapter_version, judge_rubric_version: config.primary_judge.rubric_version, status: p0 ? 'fail' : p1 ? 'pass_with_p1' : 'pass', per_dimension_absolute_delta: perDimension, mean_absolute_delta: meanAbsoluteDelta, max_absolute_delta: maxAbsoluteDelta, rank_order_consistency: rankOrderConsistency, rank_by_repetition: rankByRun, overreach_signal_consistent: overreachSignal, schema_success_rate: schemaSuccessRate, no_truncation: noTruncation, no_markdown: noMarkdown, p0, p1 };
  await Promise.all([
    writeJson(output, { schema_version: 3, status, judge_adapter_version: config.primary_judge.adapter_version, judge_rubric_version: config.primary_judge.rubric_version, expected_model: 'kimi-k2.6', thinking: 'disabled', max_completion_tokens: config.primary_judge.max_completion_tokens, temperature_control: config.primary_judge.temperature_control, temperature_parameter_sent: false, schema_valid: schemaSuccessRate === 1, completed_fixtures: completed.length, fixture_count: 9, short_fixture_calls: 6, long_fixture_calls: 3, no_truncation: noTruncation, no_markdown: noMarkdown, results, api_key_recorded: false, formal_run_started: false }),
    writeJson(stabilityOutput, stability),
  ]);
  console.log(JSON.stringify({ status, completed: completed.length, model: completed[0]?.model || null, physical_attempts: completed.reduce((sum, result) => sum + result.physical_attempts, 0), retries_recovered: completed.filter((result) => result.retries_recovered).length, fallbacks: completed.filter((result) => result.structured_output_fallback).length, no_truncation: noTruncation, no_markdown: noMarkdown, mean_absolute_delta: meanAbsoluteDelta, max_absolute_delta: maxAbsoluteDelta, rank_order_consistency: rankOrderConsistency, error: preflightError?.message || null }));
} else if (command === 'retrieval-preflight') {
  const datasetPath = path.resolve(flag('--dataset'));
  const outputDir = path.resolve(flag('--output-dir'));
  const runRoot = path.resolve(flag('--run-root', path.join(outputDir, 'run')));
  const config = await loadConfig();
  const scenarios = await readJsonl(datasetPath);
  const runtimeOptions = resolveFullOmniRuntimeOptions({
    brainServerRoot: flag('--brain-server-root', process.env.OMNI_BRAIN_SERVER_ROOT),
    expectedProductCommit: flag('--expected-product-commit', process.env.OMNI_EXPECTED_PRODUCT_COMMIT),
    expectedSelectorVersion: flag('--expected-selector-version', process.env.OMNI_EXPECTED_SELECTOR_VERSION || 'evidence-selector-v1'),
  });
  const provider = await loadProvider(config, runRoot, path.join(outputDir, 'kimi-usage-not-used.json'), runtimeOptions);
  await mkdir(outputDir, { recursive: true });
  const embeddingPreflight = await provider.preflightRuntime();
  await writeJson(path.join(outputDir, 'embedding-preflight.json'), embeddingPreflight);
  const records = [];
  for (let index = 0; index < scenarios.length; index++) {
    const scenario = scenarios[index];
    try {
      const result = await provider.retrievalPreflight(scenario, index + 1);
      const attestation = result.diagnostics.runtime_attestation;
      const gate = evaluateRetrievalPreflight(scenario, result.retrieval, {
        productCommit: attestation?.product_commit,
        expectedProductCommit: runtimeOptions.expectedProductCommit,
      });
      records.push({
        schema_version: 1,
        status: 'completed',
        scenario_id: scenario.scenario_id,
        category: scenario.category,
        diagnostics: result.diagnostics,
        candidate_pool: result.retrieval.candidatePool || [],
        final20: (result.retrieval.finalContext || []).slice(0, 20),
        answer_top10: (result.retrieval.finalContext || []).filter((item, itemIndex) => item.selected_for_answer === true || itemIndex < 10).slice(0, 10),
        selector_trace: result.retrieval.trace || null,
        fusion_config: result.retrieval.fusionConfig || null,
        gate,
      });
    } catch (error) {
      records.push({
        schema_version: 1,
        status: 'error',
        scenario_id: scenario.scenario_id,
        category: scenario.category,
        error: { type: error?.name || 'Error', message: error?.message || String(error) },
      });
    }
    await writeJsonl(path.join(outputDir, 'retrieval-results.jsonl'), records);
  }
  const summary = aggregateRetrievalPreflight(records);
  const manifest = {
    ...summary,
    command: 'retrieval-preflight',
    dataset: datasetPath,
    run_root: runRoot,
    answer_calls: 0,
    judge_calls: 0,
    expected_product_commit: runtimeOptions.expectedProductCommit,
    runtime_preflight: embeddingPreflight,
    completed_at: new Date().toISOString(),
  };
  await writeJson(path.join(outputDir, 'manifest.json'), manifest);
  console.log(JSON.stringify(manifest));
  if (!summary.passed) process.exitCode = 2;
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
  const kimiUsage = path.resolve(flag('--kimi-usage', path.join(DEFAULT_EVIDENCE, 'kimi-usage-adapter-v2.1.json')));
  const runtimeOptions = modes.includes('full_omni')
    ? resolveFullOmniRuntimeOptions({
      brainServerRoot: flag('--brain-server-root', process.env.OMNI_BRAIN_SERVER_ROOT),
      expectedProductCommit: flag('--expected-product-commit', process.env.OMNI_EXPECTED_PRODUCT_COMMIT),
      expectedSelectorVersion: flag('--expected-selector-version', process.env.OMNI_EXPECTED_SELECTOR_VERSION || 'evidence-selector-v1'),
    })
    : {};
  const provider = await loadProvider(config, runRoot, kimiUsage, runtimeOptions);
  clearShutdown();
  await mkdir(path.dirname(resultsPath), { recursive: true });
  const result = await runCalibration({ scenarios, modes, provider, resultsPath, checkpointPath, manifestPath, config, split: selected[0]?.split, backend, stopAfter: Number(flag('--stop-after', '0')) || null, injectInterruptAfter: Number(flag('--inject-interrupt-after', '0')) || null, injectErrorOnce: flag('--inject-error-once', null), retryErrorsOnly: command === 'retry-errors', selectedScenarios: selected, logger: console.log });
  console.log(JSON.stringify(result.manifest));
} else if (command === 'rejudge-results') {
  const config = await loadConfig();
  const scenarios = await readJsonl(path.resolve(flag('--dataset')));
  const rawRecords = await readJsonl(path.resolve(flag('--results')));
  const latest = new Map();
  for (const record of rawRecords) if (record.status !== 'retry') latest.set(`${record.scenario_id}:${record.mode}`, record);
  const records = [...latest.values()];
  const byId = new Map(scenarios.map((scenario) => [scenario.scenario_id, scenario]));
  const provider = await loadProvider(config, path.resolve(flag('--run-root', 'D:/OmniContext-cognitive-v1.1/rejudge-v2.1')), path.resolve(flag('--kimi-usage', path.join(DEFAULT_EVIDENCE, 'kimi-usage-adapter-v2.1.json'))));
  const rejudgedEvidence = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (record.status !== 'completed' || !['proactive_insight', 'decision_quality'].includes(record.category) || record.judge_adapter_version === config.primary_judge.adapter_version) continue;
    const scenario = byId.get(record.scenario_id);
    const result = await provider.judge({ scenario, answer: record.structured_answer, context: record.visible_context || [], phase: 'development_rejudge' });
    const score = scoreScenario({ scenario, answer: record.structured_answer, visibleSourceIds: (record.visible_context || []).map((item) => item.source_id), visibleAgents: [...new Set((record.visible_context || []).flatMap((item) => item.source_agents || []))], judge: result.structured, mode: record.mode });
    const before = { judge_adapter_version: record.judge_adapter_version || 'kimi-judge-adapter-v2.0', raw_judge_response: record.raw_judge_response, structured_judge: record.structured_judge, judge_model: record.judge_model, score: record.score, usage: record.usage?.judge || null, latency_ms: record.latency_ms?.judge || 0 };
    const v21 = { judge_adapter_version: config.primary_judge.adapter_version, judge_rubric_version: config.primary_judge.rubric_version, raw_response: result.raw, structured: result.structured, model: result.model, finish_reason: result.finish_reason, raw_character_count: result.raw_character_count, logical_judge_call: result.logical_judge_call, physical_attempts: result.physical_attempts, retries_recovered: result.retries_recovered, usage: result.usage, latency_ms: result.latency_ms, score };
    records[index] = { ...record, judge_before_adapter_v2_1: before, judge_adapter_v2_1: v21, judge_adapter_version: config.primary_judge.adapter_version, judge_rubric_version: config.primary_judge.rubric_version, raw_judge_response: result.raw, structured_judge: result.structured, judge_model: result.model, logical_judge_call: result.logical_judge_call, physical_judge_attempts: result.physical_attempts, judge_retry_recovered: result.retries_recovered, score, usage: { ...record.usage, judge: result.usage, judge_calls: 1, judge_physical_attempts: result.physical_attempts }, latency_ms: { ...record.latency_ms, judge: result.latency_ms, total: (record.latency_ms?.total || 0) - (record.latency_ms?.judge || 0) + result.latency_ms }, rejudged_at: new Date().toISOString() };
    rejudgedEvidence.push({ scenario_id: record.scenario_id, mode: record.mode, category: record.category, before, adapter_v2_1: v21 });
    console.log(`rejudged ${record.scenario_id}:${record.mode}`);
  }
  await Promise.all([
    writeJsonl(path.resolve(flag('--output')), records),
    writeJson(path.resolve(flag('--evidence-output')), { schema_version: 1, judge_adapter_version: config.primary_judge.adapter_version, judge_rubric_version: config.primary_judge.rubric_version, rejudged: rejudgedEvidence.length, source_results_unchanged: true, records: rejudgedEvidence }),
  ]);
  console.log(JSON.stringify({ rejudged: rejudgedEvidence.length, completed: records.filter((record) => record.status === 'completed').length }));
} else if (command === 'metrics') {
  const metrics = await computeMetricsFile(path.resolve(flag('--results')), path.resolve(flag('--output')));
  console.log(JSON.stringify({ completed: metrics.completed, overall: metrics.overall_cognitive_score }));
} else if (command === 'review') {
  const config = await loadConfig();
  const scenarios = await readJsonl(path.resolve(flag('--dataset')));
  const full = (await readJsonl(path.resolve(flag('--results')))).filter((record) => record.status === 'completed');
  const baseline = (await Promise.all(flag('--baseline-results').split(',').map((file) => readJsonl(path.resolve(file))))).flat().filter((record) => record.status === 'completed');
  const byId = new Map(scenarios.map((scenario) => [scenario.scenario_id, scenario]));
  const sorted = [...full].sort((a, b) => a.score.core_score - b.score.core_score || a.scenario_id.localeCompare(b.scenario_id));
  const chosen = [];
  const add = (record, stratum) => { const key = `${record.scenario_id}:${record.mode}`; if (!chosen.some((item) => item.key === key)) chosen.push({ key, record, stratum }); };
  sorted.slice(0, 5).forEach((record) => add(record, 'low'));
  sorted.slice(Math.max(0, Math.floor(sorted.length / 2) - 2), Math.floor(sorted.length / 2) + 3).forEach((record) => add(record, 'medium'));
  sorted.slice(-5).forEach((record) => add(record, 'high'));
  full.filter((record) => record.judge_retry_recovered).forEach((record) => { if (chosen.length < 20) add(record, 'baseline_or_disputed'); });
  const fullById = new Map(full.map((record) => [record.scenario_id, record]));
  [...baseline].sort((a, b) => Math.abs((fullById.get(b.scenario_id)?.score.core_score || 0) - b.score.core_score) - Math.abs((fullById.get(a.scenario_id)?.score.core_score || 0) - a.score.core_score)).slice(0, 12).forEach((record) => { if (chosen.length < 20) add(record, 'baseline_or_disputed'); });
  if (chosen.length !== 20) throw new Error(`Stratified review selection produced ${chosen.length}, expected 20`);
  const provider = await loadProvider(config, path.resolve(flag('--run-root', 'D:/OmniContext-cognitive-v1.1/review')), path.resolve(flag('--kimi-usage', path.join(DEFAULT_EVIDENCE, 'kimi-usage.json'))));
  const output = path.resolve(flag('--output'));
  let reviews = [];
  try { reviews = JSON.parse(await readFile(output, 'utf8')).reviews || []; } catch {}
  const reviewedKeys = new Set(reviews.map((review) => `${review.scenario_id}:${review.mode}`));
  for (const selection of chosen) {
    const record = selection.record;
    if (reviewedKeys.has(`${record.scenario_id}:${record.mode}`)) continue;
    const result = await provider.agentReview({ scenario_id: record.scenario_id, category: record.category, difficulty: record.difficulty, scenario_family: byId.get(record.scenario_id)?.scenario_family, review_stratum: selection.stratum, question: record.question, gold: byId.get(record.scenario_id)?.gold, mode: record.mode, visible_context: record.visible_context, structured_answer: record.structured_answer, primary_judge: record.structured_judge, computed_score_v3: record.score });
    reviews.push({ schema_version: 2, scenario_id: record.scenario_id, mode: record.mode, stratum: selection.stratum, agent_review: result.structured, raw_response: result.raw, model: result.model, usage: result.usage, latency_ms: result.latency_ms, schema_validation_attempts: result.schema_validation_attempts, secondary_review_independent: false, human_review: false, reviewed_at: new Date().toISOString() });
    reviewedKeys.add(`${record.scenario_id}:${record.mode}`);
    await writeJson(output, { schema_version: 3, status: reviews.length === 20 ? 'completed' : 'partial', review_type: 'secondary_agent_review_not_human', primary_judge_model: 'kimi-k2.6', primary_judge_independent: true, secondary_review_model: config.secondary_review.model, secondary_review_independent: false, human_review_completed: false, selection_after_final_scoring: true, count: reviews.length, strata: Object.fromEntries(['low', 'medium', 'high', 'baseline_or_disputed'].map((stratum) => [stratum, reviews.filter((review) => review.stratum === stratum).length])), reviews });
    console.log(`reviewed ${selection.stratum} ${record.scenario_id}:${record.mode}`);
  }
  await writeJson(output, { schema_version: 3, status: reviews.length === 20 ? 'completed' : 'partial', review_type: 'secondary_agent_review_not_human', primary_judge_model: 'kimi-k2.6', primary_judge_independent: true, secondary_review_model: config.secondary_review.model, secondary_review_independent: false, human_review_completed: false, selection_after_final_scoring: true, count: reviews.length, strata: Object.fromEntries(['low', 'medium', 'high', 'baseline_or_disputed'].map((stratum) => [stratum, reviews.filter((review) => review.stratum === stratum).length])), reviews });
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
  const rawRows = (await Promise.all(flag('--results').split(',').map((file) => readJsonl(path.resolve(file))))).flat();
  const latest = new Map();
  for (const record of rawRows) if (record.status !== 'retry') latest.set(`${record.scenario_id}:${record.mode}`, record);
  const rows = [...latest.values()];
  const byMode = Object.fromEntries(['no_memory', 'retrieval_only', 'full_omni'].map((mode) => [mode, aggregateResults(rows.filter((record) => record.mode === mode))]));
  const config = await loadConfig();
  await writeJson(path.resolve(flag('--output')), { schema_version: 3, status: 'DEVELOPMENT_FINAL_NOT_FORMAL', answer_schema_version: 'answer-schema-v2', scoring_version: 'deterministic-scoring-v3', judge_adapter_version: config.primary_judge.adapter_version, judge_rubric_version: config.primary_judge.rubric_version, primary_judge: 'kimi-k2.6', primary_judge_independent: true, by_mode: byMode });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(byMode).map(([mode, metrics]) => [mode, metrics.overall_cognitive_score]))));
} else {
  throw new Error('Commands: generate | preflight-kimi | retrieval-preflight | run | resume | retry-errors | rejudge-results | metrics | review | rescore | aggregate');
}
