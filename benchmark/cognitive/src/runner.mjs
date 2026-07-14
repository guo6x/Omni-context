import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scoreScenario, aggregateResults } from './scoring.mjs';
import { syntheticOracleAnswer } from './provider.mjs';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
let shutdownRequested = false;
export function requestShutdown() { shutdownRequested = true; }
export function clearShutdown() { shutdownRequested = false; }
export const stableStringify = (value) => Array.isArray(value)
  ? `[${value.map(stableStringify).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
    : JSON.stringify(value);

export async function readJsonl(file) {
  try { return (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map(JSON.parse); } catch { return []; }
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeJsonl(file, rows) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function contextForFixed(items) {
  return items.map((item) => ({ source_id: item.id, text: item.text, source: 'fixed_lexical_retrieval', source_agents: [item.agent] }));
}

function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, cache_hit_input_tokens: 0, cache_miss_input_tokens: 0 };
}

export async function runCalibration({
  scenarios,
  modes,
  provider,
  resultsPath,
  checkpointPath,
  manifestPath,
  config,
  split,
  backend,
  stopAfter = null,
  injectInterruptAfter = null,
  injectErrorOnce = null,
  retryErrorsOnly = false,
  selectedScenarios = scenarios,
  logger = () => {},
}) {
  const existing = await readJsonl(resultsPath);
  const latest = new Map(existing.map((record) => [`${record.scenario_id}:${record.mode}`, record]));
  const targets = [];
  for (const mode of modes) {
    for (const scenario of selectedScenarios) {
      const key = `${scenario.scenario_id}:${mode}`;
      if (retryErrorsOnly) {
        if (latest.get(key)?.status === 'error') targets.push({ scenario, mode, key });
      } else if (latest.get(key)?.status !== 'completed') targets.push({ scenario, mode, key });
    }
  }

  const startedAt = new Date().toISOString();
  let completedThisInvocation = 0;
  let stopRequested = false;
  const injected = new Set();
  for (let ordinal = 0; ordinal < targets.length; ordinal++) {
    if (shutdownRequested) { stopRequested = true; break; }
    if ((stopAfter && completedThisInvocation >= stopAfter) || (injectInterruptAfter && completedThisInvocation >= injectInterruptAfter)) {
      if (injectInterruptAfter) requestShutdown();
      stopRequested = true;
      break;
    }
    const { scenario, mode, key } = targets[ordinal];
    let lastError;
    for (let attempt = 0; attempt <= config.max_retries; attempt++) {
      let runtime;
      try {
        if (injectErrorOnce === scenario.scenario_id && !injected.has(key)) {
          injected.add(key);
          throw new Error('Injected one-time synthetic provider failure');
        }
        let context = [];
        let diagnostics = { extraction_calls: 0, retrieval_calls: 0, reranker_calls: 0 };
        if (mode === 'retrieval_only') context = contextForFixed(provider.fixedRetrieval(scenario));
        if (mode === 'full_omni' && backend === 'provider') {
          const full = await provider.fullOmniContext(scenario, `${ordinal + 1}-${attempt + 1}`);
          context = full.contextItems;
          diagnostics = full.diagnostics;
          runtime = full.runtime;
        }

        let answerResult;
        let judgeResult = null;
        if (backend === 'synthetic_calibration') {
          answerResult = { structured: syntheticOracleAnswer(scenario), raw: null, model: 'synthetic-calibration-oracle', latency_ms: 0, usage: emptyUsage(), attempts: 1 };
          if (['proactive_insight', 'decision_quality'].includes(scenario.category)) {
            judgeResult = { structured: {
              rubric_scores: { insight_precision: 1, insight_recall: 1, blind_spot_detection: 1, constraint_awareness: 1, actionability: 1, goal_alignment: 1, option_comparison: 1, risk_awareness: 1, internal_consistency: 1, overall_quality: 1 },
              unsupported_claim_rate: 0,
              overreach_rate: 0,
              redundant_insight_rate: 0,
              missing_required_elements: [],
              unsupported_elements: [],
              rationale: 'Synthetic scorer calibration only.',
            }, raw: null, model: 'synthetic-calibration-oracle', latency_ms: 0, usage: emptyUsage(), attempts: 1 };
          }
        } else {
          answerResult = await provider.answer({ scenario, mode, context });
          if (['proactive_insight', 'decision_quality'].includes(scenario.category)) {
            judgeResult = await provider.judge({ scenario, answer: answerResult.structured, context });
          }
        }
        const score = scoreScenario({ scenario, answer: answerResult.structured, visibleSourceIds: context.map((item) => item.source_id), visibleAgents: [...new Set(context.flatMap((item) => item.source_agents || []))], judge: judgeResult?.structured, mode });
        const record = {
          schema_version: 1,
          scenario_id: scenario.scenario_id,
          split,
          category: scenario.category,
          difficulty: scenario.difficulty,
          mode,
          status: 'completed',
          backend,
          official_locomo: false,
          synthetic_curated: true,
          answer_schema_version: 'answer-schema-v2',
          scoring_version: 'deterministic-scoring-v3',
          answer_judge_independent: true,
          primary_judge_independent: true,
          secondary_review_independent: false,
          human_review_completed: false,
          question: scenario.question,
          visible_context: context,
          raw_answer_response: answerResult.raw,
          structured_answer: answerResult.structured,
          raw_judge_response: judgeResult?.raw || null,
          structured_judge: judgeResult?.structured || null,
          judge_model: judgeResult?.model || null,
          structured_output_fallback: judgeResult?.structured_output_fallback || false,
          fallback_reason: judgeResult?.fallback_reason || null,
          score,
          diagnostics,
          usage: {
            answer: answerResult.usage,
            judge: judgeResult?.usage || emptyUsage(),
            answer_calls: 1,
            judge_calls: judgeResult ? 1 : 0,
            extraction_calls: diagnostics.extraction_calls || 0,
            reranker_calls: diagnostics.reranker_calls || 0,
          },
          latency_ms: {
            answer: answerResult.latency_ms,
            judge: judgeResult?.latency_ms || 0,
            retrieval: diagnostics.retrieval_latency_ms || 0,
            total: answerResult.latency_ms + (judgeResult?.latency_ms || 0) + (diagnostics.retrieval_latency_ms || 0) + (diagnostics.runtime_startup_and_ingestion_ms || 0),
          },
          attempts: attempt + 1,
          completed_at: new Date().toISOString(),
        };
        await appendFile(resultsPath, `${JSON.stringify(record)}\n`);
        latest.set(key, record);
        completedThisInvocation++;
        await writeJson(checkpointPath, { schema_version: 1, split, updated_at: new Date().toISOString(), completed_keys: [...latest.entries()].filter(([, r]) => r.status === 'completed').map(([k]) => k), error_keys: [...latest.entries()].filter(([, r]) => r.status === 'error').map(([k]) => k) });
        logger(`completed ${key}`);
        if (runtime) await runtime.stop();
        break;
      } catch (error) {
        lastError = error;
        if (runtime) await runtime.stop().catch(() => {});
        if (attempt < config.max_retries) {
          await appendFile(resultsPath, `${JSON.stringify({ schema_version: 1, scenario_id: scenario.scenario_id, split, category: scenario.category, mode, status: 'retry', attempt: attempt + 1, error: error.message, recorded_at: new Date().toISOString() })}\n`);
          await new Promise((resolve) => setTimeout(resolve, backend === 'synthetic_calibration' ? 0 : config.retry_base_ms * (2 ** attempt)));
        } else {
          const record = { schema_version: 1, scenario_id: scenario.scenario_id, split, category: scenario.category, difficulty: scenario.difficulty, mode, status: 'error', backend, error: lastError.message, attempts: attempt + 1, completed_at: new Date().toISOString() };
          await appendFile(resultsPath, `${JSON.stringify(record)}\n`);
          latest.set(key, record);
          if (/^KIMI_(?:CALL_LIMIT_REACHED|STOP_CONDITION|CREDENTIALS_MISSING)/.test(lastError.message)) {
            requestShutdown();
            stopRequested = true;
          }
        }
      }
    }
  }
  const finalRecords = [...latest.values()];
  const expected = selectedScenarios.length * modes.length;
  const completed = finalRecords.filter((record) => record.status === 'completed').length;
  const errors = finalRecords.filter((record) => record.status === 'error').length;
  const manifest = {
    schema_version: 1,
    benchmark: 'Omni-Context Cognitive Benchmark v1.1',
    split,
    backend,
    modes,
    status: stopRequested ? 'partial' : errors ? 'partial' : completed === expected ? 'completed' : 'blocked',
    interrupted: shutdownRequested,
    dataset_hash: sha256(selectedScenarios.map((scenario) => JSON.stringify(scenario)).join('\n') + '\n'),
    config_hash: sha256(stableStringify(config)),
    prompt_hashes: {
      answer: sha256(provider.answerPrompt),
      judge: sha256(provider.judgePrompt),
      agent_review: sha256(provider.reviewPrompt),
    },
    answer_schema_version: 'answer-schema-v2',
    scoring_version: 'deterministic-scoring-v3',
    answer_judge_independent: true,
    primary_judge_independent: true,
    secondary_review_independent: false,
    human_review_completed: false,
    started_at: startedAt,
    updated_at: new Date().toISOString(),
    expected,
    completed,
    errors,
    retry_records: (await readJsonl(resultsPath)).filter((record) => record.status === 'retry').length,
    completed_this_invocation: completedThisInvocation,
    official_locomo: false,
    conversation_2_to_10_accessed: false,
    formal_dataset_run: false,
    comparison_subset_run: false,
  };
  await writeJson(manifestPath, manifest);
  return { manifest, records: finalRecords, metrics: aggregateResults(finalRecords) };
}

export async function computeMetricsFile(resultsPath, outputPath) {
  const records = await readJsonl(resultsPath);
  const latest = new Map();
  for (const record of records) if (record.status !== 'retry') latest.set(`${record.scenario_id}:${record.mode}`, record);
  const metrics = aggregateResults([...latest.values()]);
  await writeJson(outputPath, metrics);
  return metrics;
}
