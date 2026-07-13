import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, sha256File, configHash, stableStringify, assertEvaluationEmbeddingMode } from '../integrity.mjs';
import { loadLoCoMoConversation, verifyDatasetHash, getConversationQAs, getSessions, formatSessionText, generateQuestionId, mapCategory, isAdversarial, isUnanswerable, LOCOMO_DATETIME_PARSER_VERSION, LOCOMO_TIMEZONE_ASSUMPTION } from '../dataset.mjs';
import { assertConversationAllowed } from '../splits.mjs';
import {
  createRun, completedQuestionIds, appendQuestionRecord,
  errorQuestionIds, findRunDir, verifyResumeConfig, updateManifest, readRun,
  initializeConversationRun,
} from '../run-store.mjs';
import { validateJudgeOutput, computeComposite, validateAllMetricsPresent } from '../judge/schema.mjs';
import { normalizeEvidence, validateStructuredAnswer } from '../answer/schema.mjs';
import { computeGroundingMetrics } from '../metrics/grounding.mjs';
import { createConversationRuntime, conversationDirectory } from '../conversation-runtime.mjs';

// Global flag for SIGINT/SIGTERM safe shutdown
let shutdownRequested = false;
export function requestShutdown() { shutdownRequested = true; }
export function isShutdownRequested() { return shutdownRequested; }
export function clearShutdownRequest() { shutdownRequested = false; }

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 1000;

const MANIFEST_REQUIRED_FIELDS = [
  'dataset_hash', 'dataset_source_commit', 'benchmark_commit', 'brain_server_commit',
  'answer_model', 'judge_model', 'embedding_model', 'embedding_status',
  'prompt_hash', 'judge_prompt_hash', 'config_hash', 'node_version', 'os', 'split',
  'datetime_parser_version', 'datetime_timezone_assumption',
  'conversation_ids', 'run_id', 'started_at',
];

export async function buildManifest({
  datasetPath, config, answerPrompt, judgePrompt, datasetManifest,
  split, conversationIds, runId, embeddingStatus,
}) {
  const datasetHash = await verifyDatasetHash(datasetPath, datasetManifest.sha256);
  return {
    dataset_hash: datasetHash,
    dataset_source_commit: datasetManifest.source_commit,
    benchmark_commit: config.benchmark_commit || 'unknown',
    brain_server_commit: config.brain_server_commit || 'unknown',
    answer_model: config.answer_model || process.env.ANSWER_MODEL || process.env.LLM_MODEL || 'unknown',
    judge_model: config.judge_model || process.env.JUDGE_MODEL || config.answer_model || process.env.LLM_MODEL || 'unknown',
    embedding_model: embeddingStatus.model || 'unknown',
    embedding_status: embeddingStatus,
    prompt_hash: sha256(answerPrompt),
    judge_prompt_hash: sha256(judgePrompt),
    config_hash: configHash(config),
    datetime_parser_version: LOCOMO_DATETIME_PARSER_VERSION,
    datetime_timezone_assumption: LOCOMO_TIMEZONE_ASSUMPTION,
    node_version: process.version,
    os: process.platform + ' ' + (process.arch || ''),
    split,
    conversation_ids: conversationIds,
    run_id: runId,
    started_at: new Date().toISOString(),
    completed_at: null,
  };
}

export function validateManifest(manifest) {
  const missing = MANIFEST_REQUIRED_FIELDS.filter((f) => manifest[f] === undefined || manifest[f] === null);
  if (missing.length > 0) {
    throw new Error('Manifest missing required fields: ' + missing.join(', '));
  }
}

/**
 * Ingest a conversation's sessions into the Brain Server via real GraphRAG extraction.
 * Each session is POSTed to /api/graph/extract, which triggers:
 *   LLM extraction -> entity resolution -> assertion/relationship write -> embedding
 *
 * This replaces the old ingestConversationIntoSandbox which called db.addEntity()
 * directly with type='capture_snapshot', bypassing GraphRAG entirely.
 */
export async function ingestConversation(brainServerClient, conv, convId) {
  const sessions = getSessions(conv, { conversationId: convId, evaluationMode: true });
  const result = { total_sessions: sessions.length, ingested: 0, failed: 0, errors: [], total_entities: 0, total_relationships: 0, session_diagnostics: [] };

  for (const session of sessions) {
    try {
      const text = formatSessionText(session, conv);
      if (!text || text.trim().length < 10) {
        result.errors.push({ session_id: session.session_id, error: 'Session text too short' });
        result.failed++;
        continue;
      }
      const source = `LoCoMo conv${convId} session${session.session_id}`;
      const extractResult = await brainServerClient.extract(text, source, {
        timestamp: session.parsed_timestamp,
        sessionId: String(session.session_id),
        evaluationMode: true,
      });
      result.ingested++;
      result.total_entities += extractResult?.entities || 0;
      result.total_relationships += extractResult?.relationships || 0;
      result.session_diagnostics.push({
        session_id: session.session_id,
        dataset_timestamp: {
          raw_timestamp: session.raw_date_time,
          parsed_timestamp: session.parsed_timestamp,
          parser_version: session.parser_version,
          timezone_assumption: session.timezone_assumption,
        },
        input_characters: text.length,
        status: 'completed',
        ...extractResult?.diagnostics,
      });
    } catch (err) {
      result.failed++;
      result.errors.push({
        session_id: session.session_id,
        error: err instanceof Error ? err.message : String(err),
      });
      result.session_diagnostics.push({
        session_id: session.session_id,
        dataset_timestamp: {
          raw_timestamp: session.raw_date_time,
          parsed_timestamp: session.parsed_timestamp,
          parser_version: session.parser_version,
          timezone_assumption: session.timezone_assumption,
        },
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        response: err?.responseBody,
      });
    }
    // Small delay to avoid overwhelming the Brain Server
    await new Promise((r) => setTimeout(r, 200));
  }

  return result;
}

/**
 * Process a single question with exponential backoff retry.
 * Tracks answer and judge retry counts separately.
 * Records 'retry' entries for intermediate failures, 'completed' on success,
 * or 'error' when all retries are exhausted.
 *
 * @returns {Promise<{status: 'completed'|'error', record: object}>}
 */
export async function processQuestion({
  brainServerClient,
  llmClient,
  qa,
  qid,
  convId,
  config,
  answerPrompt,
  judgePrompt,
  runDir,
  maxRetries = DEFAULT_MAX_RETRIES,
  baseBackoffMs = DEFAULT_BASE_BACKOFF_MS,
}) {
  const adversarial = isAdversarial(qa);
  const subset = adversarial ? 'adversarial' : 'answerable';
  const categoryName = mapCategory(qa.category);

  let answerRetryCount = 0;
  let judgeRetryCount = 0;
  let retryRecordCount = 0;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (isShutdownRequested()) {
      const interruptedRecord = {
        question_id: qid,
        conversation_id: convId,
        status: 'interrupted',
        subset,
        category: qa.category,
        category_name: categoryName,
        question: qa.question,
        reference_answer: qa.answer,
        error: 'Shutdown requested (SIGINT/SIGTERM)',
        error_type: 'ShutdownRequested',
        answer_retry_count: answerRetryCount,
        judge_retry_count: judgeRetryCount,
        retry_count: retryRecordCount,
      };
      return { status: 'interrupted', record: interruptedRecord };
    }

    try {
      // 1. Retrieve memories via unified_memory_search
      const retrievalStart = Date.now();
      const retrieval = await brainServerClient.unifiedMemorySearch(qa.question, config.retrieval?.top_k || 10);
      const retrievalLatency = Date.now() - retrievalStart;

      // 2. Generate answer via LLM
      const evidence = normalizeEvidence(retrieval);
      let candidateAnswer, structuredAnswer, rawAnswerResponse, answerLatency;
      try {
        const answerResult = await llmClient.answer(qa.question, retrieval, answerPrompt);
        structuredAnswer = validateStructuredAnswer(answerResult.structuredAnswer, evidence);
        candidateAnswer = structuredAnswer.answer;
        rawAnswerResponse = answerResult.rawAnswerResponse;
        answerLatency = answerResult.latencyMs;
      } catch (answerErr) {
        answerRetryCount++;
        throw answerErr;
      }

      // 3. Judge the answer via LLM
      let judgeResult, judgeLatency, judgeRawResponse;
      try {
        const judgeInput = {
          question: qa.question,
          reference_answer: String(qa.answer || ''),
          structured_answer: structuredAnswer,
          evidence,
          reference_evidence: qa.evidence || qa.supporting_evidence || [],
          temporal_query: retrieval?.temporalQuery || { mode: 'current', as_of: null },
          subset,
          answerable: !isUnanswerable(qa),
          adversarial,
        };
        const judgeOutput = await llmClient.judge(judgeInput, judgePrompt);
        judgeResult = validateJudgeOutput(judgeOutput.metrics);
        judgeLatency = judgeOutput.latencyMs;
        judgeRawResponse = judgeOutput.rawJudgeResponse;
      } catch (judgeErr) {
        judgeRetryCount++;
        throw new Error(`Judge failed: ${judgeErr.message}`);
      }

      // 4. Compute citation validity/precision and stale adoption deterministically.
      const groundingMetrics = computeGroundingMetrics({
        answer: structuredAnswer,
        evidence,
        claimEvaluations: judgeResult.claim_evaluations,
        temporalQuery: retrieval?.temporalQuery || { mode: 'current', as_of: null },
        evaluatedAt: new Date().toISOString(),
      });
      const metrics = {
        binary_accuracy: judgeResult.binary_accuracy,
        factual_score: judgeResult.factual_score,
        temporal_score: judgeResult.temporal_score,
        contextual_score: judgeResult.contextual_score,
        abstention_accuracy: judgeResult.abstention_accuracy,
        evidence_precision: groundingMetrics.evidence_precision,
        stale_memory_leakage: groundingMetrics.stale_memory_leakage,
      };
      validateAllMetricsPresent(metrics);

      // Success — save completed record
      const record = {
        question_id: qid,
        conversation_id: convId,
        status: 'completed',
        subset,
        category: qa.category,
        category_name: categoryName,
        question: qa.question,
        reference_answer: qa.answer,
        candidate_answer: candidateAnswer,
        structured_answer: structuredAnswer,
        raw_answer_response: rawAnswerResponse,
        retrieval_count: retrieval?.results?.length || 0,
        evidence,
        evidence_ids: evidence.map((item) => item.id),
        temporal_query: retrieval?.temporalQuery || { mode: 'current', as_of: null },
        judge_raw: judgeRawResponse,
        judge_semantic_scores: judgeResult,
        evidence_counts: groundingMetrics.evidence_counts,
        stale_counts: groundingMetrics.stale_counts,
        metrics,
        retrieval_latency_ms: retrievalLatency,
        answer_latency_ms: answerLatency,
        judge_latency_ms: judgeLatency,
        total_latency_ms: retrievalLatency + answerLatency + judgeLatency,
        answer_retry_count: answerRetryCount,
        judge_retry_count: judgeRetryCount,
        retry_count: retryRecordCount,
      };

      await appendQuestionRecord(runDir, record);
      return { status: 'completed', record };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        // Record retry attempt (persisted to JSONL)
        const backoff = Math.pow(2, attempt) * baseBackoffMs;
        console.error(`[benchmark] ${qid} attempt ${attempt + 1} failed: ${err.message}, retrying in ${backoff}ms...`);

        await appendQuestionRecord(runDir, {
          question_id: qid,
          conversation_id: convId,
          status: 'retry',
          subset,
          category: qa.category,
          category_name: categoryName,
          question: qa.question,
          error: err instanceof Error ? err.message : String(err),
          error_type: err instanceof Error ? err.constructor.name : 'Unknown',
          retry_count: attempt + 1,
          answer_retry_count: answerRetryCount,
          judge_retry_count: judgeRetryCount,
        });
        retryRecordCount++;

        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  // All retries exhausted — record as error
  const errorRecord = {
    question_id: qid,
    conversation_id: convId,
    status: 'error',
    subset,
    category: qa.category,
    category_name: categoryName,
    question: qa.question,
    reference_answer: qa.answer,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    error_type: lastError instanceof Error ? lastError.constructor.name : 'Unknown',
    answer_retry_count: answerRetryCount,
    judge_retry_count: judgeRetryCount,
    retry_count: retryRecordCount,
  };
  await appendQuestionRecord(runDir, errorRecord);
  return { status: 'error', record: errorRecord };
}

/**
 * Run the benchmark against a real Brain Server with real LLM answer + judge.
 * Creates a NEW run directory. Use resumeBenchmark() to continue an existing run.
 */
export async function runBenchmark({
  llmClient,
  datasetPath,
  config,
  answerPrompt,
  judgePrompt,
  datasetManifest,
  split,
  conversationIds,
  runsRoot,
  runtimeFactory = createConversationRuntime,
  brainServerRoot,
  evaluationAuthorization,
}) {
  clearShutdownRequest();
  if (!llmClient) throw new Error('llmClient is required (LLMClient instance) — null is forbidden');
  if (split === 'heldout' && !evaluationAuthorization) {
    throw new Error('Held-out run requires a verified evaluation authorization manifest.');
  }
  await verifyDatasetHash(datasetPath, datasetManifest.sha256);

  // Create run directory
  const runId = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(runsRoot, runId);
  await mkdir(runDir, { recursive: true });
  for (const conversationId of conversationIds) {
    await initializeConversationRun(runDir, conversationId);
  }

  // Write manifest
  const manifest = await buildManifest({
    datasetPath, config, answerPrompt, judgePrompt,
    datasetManifest, split, conversationIds, runId,
    embeddingStatus: { mode: 'pending', model: 'pending', available: false, status: 'pending' },
  });
  if (split === 'heldout') {
    manifest.evaluation_authorization = evaluationAuthorization;
  }
  validateManifest(manifest);
  await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });

  let stats;
  try {
    stats = await runQuestions({
      llmClient, datasetPath, config, answerPrompt, judgePrompt,
      split, conversationIds, runDir, runtimeFactory, brainServerRoot,
      resumeRuntime: false,
      heldoutAuthorization: evaluationAuthorization?.authorization,
    });
  } catch (error) {
    await updateManifest(runDir, {
      completed_at: new Date().toISOString(),
      status: 'failed',
      failure: {
        type: error instanceof Error ? error.constructor.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }

  // Update manifest with completion status
  const finalStatus = stats.errors > 0 || stats.done + stats.skipped < stats.total ? 'partial' : 'completed';
  await updateManifest(runDir, {
    completed_at: new Date().toISOString(),
    status: isShutdownRequested() ? 'interrupted' : finalStatus,
    statistics: manifestStatistics(stats),
  });

  return {
    runDir,
    manifest: { ...manifest, status: isShutdownRequested() ? 'interrupted' : finalStatus },
    stats,
  };
}

/**
 * Resume an existing run. Reads the run directory, verifies config/prompt hashes
 * match, skips completed questions, and continues processing remaining ones.
 * Does NOT re-ingest conversations (they're already in the Brain Server DB).
 */
export async function resumeBenchmark({
  llmClient,
  datasetPath,
  config,
  answerPrompt,
  judgePrompt,
  datasetManifest,
  runsRoot,
  runId,
  runtimeFactory = createConversationRuntime,
  brainServerRoot,
}) {
  clearShutdownRequest();
  if (!llmClient) throw new Error('llmClient is required');

  const runDir = await findRunDir(runsRoot, runId);
  const { manifest } = await readRun(runDir);
  await verifyDatasetHash(datasetPath, manifest.dataset_hash);

  // Verify config and prompt match the existing run
  verifyResumeConfig(manifest, config, answerPrompt, judgePrompt);

  // Resume: skip completed, re-run errors and remaining
  let stats;
  try {
    stats = await runQuestions({
      llmClient, datasetPath, config, answerPrompt, judgePrompt,
      split: manifest.split,
      conversationIds: manifest.conversation_ids,
      runDir, runtimeFactory, brainServerRoot, resumeRuntime: true,
      heldoutAuthorization: manifest.evaluation_authorization?.authorization,
    });
  } catch (error) {
    await updateManifest(runDir, {
      completed_at: new Date().toISOString(),
      status: 'failed',
      resumed_at: new Date().toISOString(),
      failure: {
        type: error instanceof Error ? error.constructor.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }

  const finalStatus = stats.errors > 0 || stats.done + stats.skipped < stats.total ? 'partial' : 'completed';
  const resolvedStatus = isShutdownRequested() ? 'interrupted' : finalStatus;
  await updateManifest(runDir, {
    completed_at: new Date().toISOString(),
    status: resolvedStatus,
    resumed_at: new Date().toISOString(),
    statistics: manifestStatistics(stats),
  });

  return { runDir, manifest: { ...manifest, status: resolvedStatus }, stats };
}

/**
 * Retry only the error questions from an existing run.
 * Re-runs each error question with full retry/backoff logic.
 */
export async function retryErrors({
  llmClient,
  datasetPath,
  config,
  answerPrompt,
  judgePrompt,
  datasetManifest,
  runsRoot,
  runId,
  runtimeFactory = createConversationRuntime,
  brainServerRoot,
}) {
  clearShutdownRequest();
  if (!llmClient) throw new Error('llmClient is required');

  const runDir = await findRunDir(runsRoot, runId);
  const { manifest } = await readRun(runDir);
  await verifyDatasetHash(datasetPath, manifest.dataset_hash);

  // Verify config and prompt match
  verifyResumeConfig(manifest, config, answerPrompt, judgePrompt);

  const errorIds = await errorQuestionIds(runDir);

  if (errorIds.size === 0) {
    console.log('[benchmark] No error questions to retry.');
    return { runDir, manifest, stats: { total: 0, done: 0, errors: 0, retries: 0, skipped: 0 } };
  }

  console.log(`[benchmark] Retrying ${errorIds.size} error questions...`);

  let done = 0;
  let errors = 0;
  let retries = 0;

  for (const convId of manifest.conversation_ids) {
    assertConversationAllowed({
      split: manifest.split,
      conversationId: convId,
      heldoutAuthorization: manifest.evaluation_authorization?.authorization,
    });
    const conv = await loadLoCoMoConversation(datasetPath, convId);
    const qas = getConversationQAs(null, conv);
    const targetQuestions = qas.filter((qa, qi) => errorIds.has(generateQuestionId(convId, qa, qi)));
    if (targetQuestions.length === 0) continue;

    const runtime = await runtimeFactory({ runDir, conversationId: convId, resume: true, brainServerRoot });
    await runtime.start();
    try {
      const brainServerClient = runtime.client;
      await assertRuntimePreflight(brainServerClient, runDir, convId);
      for (let qi = 0; qi < qas.length; qi++) {
        const qa = qas[qi];
        const qid = generateQuestionId(convId, qa, qi);

        if (!errorIds.has(qid)) continue;

        const result = await processQuestion({
          brainServerClient, llmClient, qa, qid, convId,
          config, answerPrompt, judgePrompt, runDir,
          ...retryOptions(config),
        });

        if (result.status === 'completed') done++;
        else errors++;
        retries += result.record.retry_count || 0;
      }
    } finally {
      const stopped = await runtime.stop();
      await recordRuntimeResult(runDir, convId, stopped);
    }
  }

  const runSummary = await summarizeRunRecords(runDir, manifest.statistics?.expected_questions);
  const retryStatus = runSummary.expected_questions !== null
    && runSummary.completed_questions === runSummary.expected_questions
    && runSummary.errors === 0 ? 'completed' : 'partial';
  await updateManifest(runDir, {
    completed_at: new Date().toISOString(),
    status: retryStatus,
    retried_at: new Date().toISOString(),
    statistics: runSummary,
  });

  return {
    runDir,
    manifest: { ...manifest, status: retryStatus },
    stats: { total: errorIds.size, done, errors, retries, skipped: 0 },
  };
}

/**
 * Internal: run all questions for the given conversation IDs.
 * Shared by runBenchmark (new run) and resumeBenchmark (existing run).
 * Skips already-completed questions (resume support).
 */
async function runQuestions({
  llmClient,
  datasetPath,
  config,
  answerPrompt,
  judgePrompt,
  split,
  conversationIds,
  runDir,
  runtimeFactory,
  brainServerRoot,
  resumeRuntime,
  heldoutAuthorization,
}) {
  const completed = await completedQuestionIds(runDir);

  let total = 0;
  let done = 0;
  let errors = 0;
  let retries = 0;
  let skipped = 0;
  let interrupted = false;

  for (const convId of conversationIds) {
    assertConversationAllowed({ split, conversationId: convId, heldoutAuthorization });

    const conv = await loadLoCoMoConversation(datasetPath, convId);
    const qas = getConversationQAs(null, conv);
    total += qas.length;

    const runtime = await runtimeFactory({
      runDir,
      conversationId: convId,
      resume: resumeRuntime,
      brainServerRoot,
    });
    await runtime.start();

    try {
      const brainServerClient = runtime.client;
      await assertRuntimePreflight(brainServerClient, runDir, convId);
      const ingestionPath = path.join(conversationDirectory(runDir, convId), 'ingestion.json');
      const ingestion = await readJson(ingestionPath);
      if (ingestion?.status !== 'completed') {
        console.log(`[benchmark] Ingesting conversation ${convId}...`);
        const ingestResult = await ingestConversation(brainServerClient, conv, convId);
        const diagnosticsPath = path.join(conversationDirectory(runDir, convId), 'extraction-diagnostics.jsonl');
        await writeFile(
          diagnosticsPath,
          ingestResult.session_diagnostics.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
        );
        const ingestionRecord = {
          schema_version: 1,
          conversation_id: Number(convId),
          status: ingestResult.failed === 0 ? 'completed' : 'failed',
          completed_at: new Date().toISOString(),
          ...ingestResult,
          session_diagnostics: undefined,
        };
        await writeFile(ingestionPath, `${JSON.stringify(ingestionRecord, null, 2)}\n`);
        console.log(`[benchmark] Ingestion complete: ${ingestResult.ingested}/${ingestResult.total_sessions} sessions, ` +
          `${ingestResult.total_entities} entities, ${ingestResult.total_relationships} relationships, ` +
          `${ingestResult.failed} failed`);
        if (ingestResult.failed > 0) {
          throw new Error(`Conversation ${convId} ingestion failed for ${ingestResult.failed} sessions`);
        }
      } else {
        console.log(`[benchmark] Conversation ${convId} already ingested, reusing its isolated database.`);
      }

      for (let qi = 0; qi < qas.length; qi++) {
        const qa = qas[qi];
        const qid = generateQuestionId(convId, qa, qi);

        // Skip already-completed questions (resume support)
        if (completed.has(qid)) {
          skipped++;
          continue;
        }

        if (isShutdownRequested()) {
          console.log('[benchmark] Shutdown requested, stopping safely...');
          break;
        }

        const result = await processQuestion({
          brainServerClient, llmClient, qa, qid, convId,
          config, answerPrompt, judgePrompt, runDir,
          ...retryOptions(config),
        });

        retries += result.record.retry_count || 0;
        if (result.status === 'completed') {
          done++;
          const acc = result.record.metrics?.binary_accuracy === 1;
          if (done % 10 === 0 || qi === qas.length - 1) {
            console.log(`[benchmark] ${qid} [${done}/${total}] ${acc ? 'PASS' : 'FAIL'} (retrieval: ${result.record.retrieval_count}, ${result.record.retrieval_latency_ms}ms)`);
          }
        } else if (result.status === 'interrupted') {
          interrupted = true;
          break;
        } else {
          errors++;
        }
      }
    } finally {
      const stopped = await runtime.stop();
      await recordRuntimeResult(runDir, convId, stopped);
    }

    if (isShutdownRequested() || interrupted) break;
  }

  return { total, done, errors, retries, skipped, interrupted };
}

function manifestStatistics(stats) {
  return {
    expected_questions: stats.total,
    completed_questions: stats.done + stats.skipped,
    completed_this_invocation: stats.done,
    errors: stats.errors,
    retry_records_this_invocation: stats.retries,
    skipped_completed: stats.skipped,
    interrupted: stats.interrupted === true,
  };
}

function retryOptions(config) {
  return {
    maxRetries: Number.isInteger(config.retry?.max_retries)
      ? Math.max(0, config.retry.max_retries)
      : DEFAULT_MAX_RETRIES,
    baseBackoffMs: Number.isFinite(config.retry?.base_backoff_ms)
      ? Math.max(0, config.retry.base_backoff_ms)
      : DEFAULT_BASE_BACKOFF_MS,
  };
}

async function summarizeRunRecords(runDir, expectedQuestions) {
  const { records } = await readRun(runDir);
  const latest = new Map();
  const completedCounts = new Map();
  let retryRecords = 0;
  for (const record of records) {
    latest.set(record.question_id, record);
    if (record.status === 'retry') retryRecords++;
    if (record.status === 'completed') {
      completedCounts.set(record.question_id, (completedCounts.get(record.question_id) || 0) + 1);
    }
  }
  return {
    expected_questions: Number.isInteger(expectedQuestions) ? expectedQuestions : null,
    completed_questions: [...latest.values()].filter((record) => record.status === 'completed').length,
    errors: [...latest.values()].filter((record) => record.status === 'error').length,
    retry_records: retryRecords,
    duplicate_completed_records: [...completedCounts.values()].filter((count) => count > 1).length,
  };
}

async function assertRuntimePreflight(brainServerClient, runDir, conversationId) {
  if (!brainServerClient) throw new Error(`Conversation ${conversationId} runtime did not expose a BrainServerClient`);
  const preflight = await brainServerClient.preflight();
  const embeddingStatus = {
    mode: preflight.embeddingStatus.mode,
    model: preflight.embeddingStatus.model,
    available: preflight.embeddingStatus.healthy,
    status: preflight.embeddingStatus.status,
  };
  assertEvaluationEmbeddingMode(embeddingStatus);
  const { manifest } = await readRun(runDir);
  await updateManifest(runDir, {
    embedding_model: manifest.embedding_model === 'pending' ? embeddingStatus.model : manifest.embedding_model,
    embedding_status: manifest.embedding_status?.status === 'pending' ? embeddingStatus : manifest.embedding_status,
    embedding_by_conversation: {
      ...(manifest.embedding_by_conversation || {}),
      [conversationId]: embeddingStatus,
    },
  });
  return preflight;
}

async function recordRuntimeResult(runDir, conversationId, stopped) {
  const { manifest } = await readRun(runDir);
  await updateManifest(runDir, {
    conversation_databases: {
      ...(manifest.conversation_databases || {}),
      [conversationId]: {
        relative_path: `conversation-${conversationId}/brain.db`,
        sha256: stopped.databaseHash,
        stopped_cleanly: stopped.exitCode === 0 || stopped.exitCode === 'SIGTERM',
      },
    },
  });
}

async function readJson(filePath) {
  try { return JSON.parse(await readFile(filePath, 'utf8')); } catch { return null; }
}
