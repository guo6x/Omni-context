#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CognitiveProvider } from '../src/provider.mjs';
import { aggregateResults } from '../src/scoring.mjs';
import { readJsonl, runCalibration, stableStringify, writeJson } from '../src/runner.mjs';
import {
  buildInterleavedPlan,
  CONDITION_TO_ENV,
  STRICT_ABLATION_CONDITIONS,
} from './strict-ablation-plan.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const COGNITIVE_ROOT = path.resolve(MODULE_DIR, '..');
const FROZEN_PRODUCT_BASE = '17dc1d0107b0474de84058205a91b302ba290a74';
const FROZEN_BENCHMARK_COMMIT = '62b0b20f944f7e9a2c58f02ce1c65bb43dfbf841';

function flag(name, fallback = undefined) {
  const assigned = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  if (assigned) return assigned.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function loadJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function withAblationEnvironment(ablation, operation) {
  const previousMode = process.env.OMNI_RESEARCH_ABLATION_MODE;
  const previousAblation = process.env.OMNI_ABLATION;
  process.env.OMNI_RESEARCH_ABLATION_MODE = '1';
  process.env.OMNI_ABLATION = ablation;
  try {
    return await operation();
  } finally {
    if (previousMode === undefined) delete process.env.OMNI_RESEARCH_ABLATION_MODE;
    else process.env.OMNI_RESEARCH_ABLATION_MODE = previousMode;
    if (previousAblation === undefined) delete process.env.OMNI_ABLATION;
    else process.env.OMNI_ABLATION = previousAblation;
  }
}

function captureResearchEvidence(rawRetrieval, condition, ablation) {
  const finalContext = rawRetrieval?.finalContext || [];
  return {
    schema_version: 1,
    condition,
    ablation,
    candidate_pool: rawRetrieval?.candidatePool || [],
    final_20: finalContext.slice(0, 20),
    answer_top_10: finalContext
      .filter((item, index) => item.selected_for_answer === true || index < 10)
      .slice(0, 10),
    fusion_config: rawRetrieval?.fusionConfig || null,
    search_methods: rawRetrieval?.searchMethods || null,
    research_ablation: rawRetrieval?.researchAblation || null,
  };
}

function instrumentProvider(provider, condition) {
  const ablation = CONDITION_TO_ENV[condition];
  const original = provider.fullOmniContext.bind(provider);
  provider.fullOmniContext = async (...args) => withAblationEnvironment(ablation, async () => {
    const result = await original(...args);
    result.diagnostics.strict_ablation = captureResearchEvidence(result.rawRetrieval, condition, ablation);
    return result;
  });
  return provider;
}

function expectedCallProfile(scenarios) {
  const perConditionExtraction = scenarios.reduce((sum, scenario) =>
    sum + Math.max(1, Math.min(4, (scenario.state_transition_count || 0) + 1)), 0);
  const judgedPerCondition = scenarios.filter((scenario) =>
    ['proactive_insight', 'decision_quality'].includes(scenario.category)).length;
  const conditions = STRICT_ABLATION_CONDITIONS.length;
  return {
    scenarios: scenarios.length,
    conditions,
    scenario_condition_runs: scenarios.length * conditions,
    deepseek_logical: (perConditionExtraction + scenarios.length + scenarios.length) * conditions,
    kimi_logical: judgedPerCondition * conditions,
    extraction: perConditionExtraction * conditions,
    reranker: scenarios.length * conditions,
    answer: scenarios.length * conditions,
    judge: judgedPerCondition * conditions,
  };
}

async function budgetSnapshot(outputRoot, scenarios) {
  const expected = expectedCallProfile(scenarios);
  let completed = 0;
  let errors = 0;
  let retries = 0;
  let extraction = 0;
  let reranker = 0;
  let answerPhysicalProxy = 0;
  let kimiPhysical = 0;
  for (const condition of STRICT_ABLATION_CONDITIONS) {
    const root = path.join(outputRoot, 'conditions', condition);
    const rows = await readJsonl(path.join(root, 'results.jsonl'));
    retries += rows.filter((row) => row.status === 'retry').length;
    const latest = new Map();
    for (const row of rows) if (row.status !== 'retry') latest.set(row.scenario_id, row);
    for (const row of latest.values()) {
      if (row.status === 'completed') {
        completed++;
        extraction += Number(row.diagnostics?.extraction_calls || 0);
        reranker += Number(row.diagnostics?.reranker_calls || 0);
        answerPhysicalProxy += Number(row.answer_schema_validation_attempts || 1);
      } else if (row.status === 'error') errors++;
    }
    try {
      const ledger = await loadJson(path.join(root, 'kimi-usage.json'));
      kimiPhysical += Number(ledger.physical_attempts || 0);
    } catch {}
  }
  const deepseekKnown = extraction + reranker + answerPhysicalProxy;
  const limits = {
    scenario_condition_runs: expected.scenario_condition_runs,
    deepseek_known_plus_15_percent: Math.ceil(expected.deepseek_logical * 1.15),
    kimi_physical_plus_15_percent: Math.ceil(expected.kimi_logical * 1.15),
  };
  return {
    schema_version: 1,
    expected,
    limits,
    observed: { completed, errors, retries, extraction, reranker, answer_physical_proxy: answerPhysicalProxy, deepseek_known: deepseekKnown, kimi_physical: kimiPhysical },
    exceeded: completed + errors > limits.scenario_condition_runs
      || deepseekKnown > limits.deepseek_known_plus_15_percent
      || kimiPhysical > limits.kimi_physical_plus_15_percent,
  };
}

async function main() {
  const datasetPath = path.resolve(flag('--dataset'));
  const outputRoot = path.resolve(flag('--output-root'));
  const brainServerRoot = path.resolve(flag('--brain-server-root'));
  const expectedProductCommit = flag('--expected-product-commit');
  const seed = Number(flag('--seed', '2026071701'));
  const resume = process.argv.includes('--resume');
  if (!/^[a-f0-9]{40}$/.test(expectedProductCommit || '')) throw new Error('--expected-product-commit must be an exact SHA');
  if (!process.env.LLM_API_URL || !process.env.LLM_API_KEY) throw new Error('DeepSeek provider environment is incomplete');
  if (!process.env.MOONSHOT_API_KEY) throw new Error('KIMI_CREDENTIALS_MISSING:MOONSHOT_API_KEY');
  if (!process.env.EMBEDDING_LOCAL_MODEL_PATH) throw new Error('EMBEDDING_LOCAL_MODEL_PATH is required');

  if (!resume && await exists(outputRoot) && (await readdir(outputRoot)).length > 0) {
    throw new Error(`Fresh strict ablation output root must be empty: ${outputRoot}`);
  }
  await mkdir(outputRoot, { recursive: true });
  const [datasetText, scenarios, config, answerPrompt, judgePrompt, reviewPrompt] = await Promise.all([
    readFile(datasetPath, 'utf8'),
    readJsonl(datasetPath),
    loadJson(path.join(COGNITIVE_ROOT, 'config', 'default.json')),
    readFile(path.join(COGNITIVE_ROOT, 'prompts', 'answer-v2.txt'), 'utf8'),
    readFile(path.join(COGNITIVE_ROOT, 'prompts', 'judge-v2-kimi.txt'), 'utf8'),
    readFile(path.join(COGNITIVE_ROOT, 'prompts', 'agent-review-v1.txt'), 'utf8'),
  ]);
  if (scenarios.length !== 35 || scenarios.some((scenario) => scenario.split !== 'development')) {
    throw new Error(`Strict ablation requires the fixed Development-35 dataset, received ${scenarios.length}`);
  }
  const plan = buildInterleavedPlan(scenarios, seed);
  const planRecord = {
    schema_version: 1,
    created_before_provider_calls: true,
    seed,
    dataset_path: datasetPath,
    dataset_sha256: sha256(datasetText),
    frozen_product_base_commit: FROZEN_PRODUCT_BASE,
    research_instrumentation_commit: expectedProductCommit,
    frozen_benchmark_commit: FROZEN_BENCHMARK_COMMIT,
    config_sha256: sha256(stableStringify(config)),
    prompt_hashes: {
      answer: sha256(answerPrompt),
      judge: sha256(judgePrompt),
      agent_review: sha256(reviewPrompt),
    },
    conditions: STRICT_ABLATION_CONDITIONS,
    plan,
  };
  const planPath = path.join(outputRoot, 'run-order.json');
  if (!resume || !await exists(planPath)) await writeJson(planPath, planRecord);
  else {
    const existing = await loadJson(planPath);
    if (existing.dataset_sha256 !== planRecord.dataset_sha256 || existing.seed !== seed || existing.research_instrumentation_commit !== expectedProductCommit) {
      throw new Error('Resume attestation mismatch');
    }
  }

  const providers = Object.fromEntries(STRICT_ABLATION_CONDITIONS.map((condition) => {
    const conditionRoot = path.join(outputRoot, 'conditions', condition);
    const provider = new CognitiveProvider({
      config,
      answerPrompt,
      judgePrompt,
      reviewPrompt,
      runRoot: path.join(conditionRoot, 'run'),
      brainServerRoot,
      expectedProductCommit,
      expectedSelectorVersion: 'evidence-selector-v2',
      kimiUsagePath: path.join(conditionRoot, 'kimi-usage.json'),
    });
    return [condition, instrumentProvider(provider, condition)];
  }));

  const preflightPath = path.join(outputRoot, 'embedding-preflight.json');
  if (!resume || !await exists(preflightPath)) {
    const preflight = await withAblationEnvironment('none', () => providers.full_omni_fresh_control.preflightRuntime());
    if (preflight.status !== 'passed' || preflight.embedding?.status !== 'local' || preflight.embedding?.actualDimension !== 1024) {
      throw new Error(`Strict ablation preflight failed: ${JSON.stringify(preflight)}`);
    }
    await writeJson(preflightPath, { ...preflight, executed_once_before_scenario_loop: true });
  }

  const scheduledByCondition = Object.fromEntries(STRICT_ABLATION_CONDITIONS.map((condition) => [condition, []]));
  const byId = new Map(scenarios.map((scenario) => [scenario.scenario_id, scenario]));
  let stopReason = null;
  for (const entry of plan) {
    const condition = entry.condition;
    const scenario = byId.get(entry.scenario_id);
    scheduledByCondition[condition].push(scenario);
    const root = path.join(outputRoot, 'conditions', condition);
    await mkdir(root, { recursive: true });
    const result = await runCalibration({
      scenarios,
      modes: ['full_omni'],
      provider: providers[condition],
      resultsPath: path.join(root, 'results.jsonl'),
      checkpointPath: path.join(root, 'checkpoint.json'),
      manifestPath: path.join(root, 'manifest.json'),
      config,
      split: 'development',
      backend: 'provider',
      selectedScenarios: scheduledByCondition[condition],
      logger: (message) => process.stdout.write(`${condition} ${message}\n`),
    });
    const budget = await budgetSnapshot(outputRoot, scenarios);
    await writeJson(path.join(outputRoot, 'call-budget.json'), budget);
    await writeJson(path.join(outputRoot, 'progress.json'), {
      schema_version: 1,
      last_plan_ordinal: entry.ordinal,
      last_scenario_id: entry.scenario_id,
      last_condition: condition,
      budget,
      updated_at: new Date().toISOString(),
    });
    if (budget.exceeded) {
      stopReason = 'CALL_BUDGET_EXCEEDED';
      break;
    }
    const latest = result.records.find((record) => record.scenario_id === scenario.scenario_id && record.mode === 'full_omni');
    if (latest?.status === 'error' && /^KIMI_(?:CALL_LIMIT_REACHED|STOP_CONDITION|CREDENTIALS_MISSING)/.test(latest.error || '')) {
      stopReason = latest.error;
      break;
    }
  }

  const conditionSummaries = {};
  let completed = 0;
  let errors = 0;
  let retries = 0;
  for (const condition of STRICT_ABLATION_CONDITIONS) {
    const root = path.join(outputRoot, 'conditions', condition);
    const rows = await readJsonl(path.join(root, 'results.jsonl'));
    const latest = new Map();
    for (const row of rows) if (row.status !== 'retry') latest.set(row.scenario_id, row);
    const records = [...latest.values()];
    const metrics = aggregateResults(records);
    const summary = {
      schema_version: 1,
      condition,
      ablation: CONDITION_TO_ENV[condition],
      completed: records.filter((record) => record.status === 'completed').length,
      errors: records.filter((record) => record.status === 'error').length,
      retry_records: rows.filter((record) => record.status === 'retry').length,
      metrics,
    };
    conditionSummaries[condition] = summary;
    completed += summary.completed;
    errors += summary.errors;
    retries += summary.retry_records;
    await writeJson(path.join(root, 'condition-summary.json'), summary);
  }
  const budget = await budgetSnapshot(outputRoot, scenarios);
  const manifest = {
    schema_version: 1,
    status: stopReason ? 'partial' : completed === 140 && errors === 0 ? 'completed' : 'partial',
    stop_reason: stopReason,
    expected: 140,
    completed,
    errors,
    retry_records: retries,
    seed,
    dataset_sha256: sha256(datasetText),
    frozen_product_base_commit: FROZEN_PRODUCT_BASE,
    research_instrumentation_commit: expectedProductCommit,
    frozen_benchmark_commit: FROZEN_BENCHMARK_COMMIT,
    benchmark_behavior_modified: false,
    formal_run: false,
    comparison_run: false,
    official_locomo: false,
    conversation_2_to_10_accessed: false,
    call_budget: budget,
    conditions: conditionSummaries,
    completed_at: new Date().toISOString(),
  };
  await writeJson(path.join(outputRoot, 'manifest.json'), manifest);
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
  if (manifest.status !== 'completed') process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ event: 'strict_ablation_run_failed', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
