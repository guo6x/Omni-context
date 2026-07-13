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
import { createConversationRuntime, conversationDirectory } from '../conversation-runtime.mjs';

// Global flag for SIGINT/SIGTERM safe shutdown
let shutdownRequested = false;
export function requestShutdown() { shutdownRequested = true; }
export function isShutdownRequested() { return shutdownRequested; }

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_BACKOFF_MS = 1000;

const MANIFEST_REQUIRED_FIELDS = [
  'dataset_hash', 'dataset_source_commit', 'benchmark_commit', 'brain_server_commit',
  'answer_model', 'judge_model', 'embedding_model', 'embedding_status',
  'prompt_hash', 'config_hash', 'node_version', 'os', 'split',
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
  const result = { total_sessions: sessions.length, ingested: 0, failed: 0, errors: [], total_entities: 0, total_relationships: 0 };

  for (const session of sessions) {
    try {
      const text = formatSessionText(session, conv);
      if (!text || text.trim().length < 10) {
        result.errors.push({ session_id: session.session_id, error: 'Session text too short' });
        result.failed++;
        continue;
      }
      const source = `LoCoMo conv${convId} session${session.session_id}`;
      const extractResult = await brainServerClient.extract(text, source);
      result.ingested++;
      result.total_entities += extractResult?.entities || 0;
      result.total_relationships += extractResult?.relationships || 0;
    } catch (err) {
      result.failed++;
      result.errors.push({
        session_id: session.session_id,
        error: err instanceof Error ? err.message : String(err),
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
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (isShutdownRequested()) {
      const errorRecord = {
        question_id: qid,
        conversation_id: convId,
        status: 'error',
        subset,
        category: qa.category,
        category_name: categoryName,
        question: qa.question,
        reference_answer: qa.answer,
        error: 'Shutdown requested (SIGINT/SIGTERM)',
        error_type: 'ShutdownRequested',
        answer_retry_count: answerRetryCount,
        judge_retry_count: judgeRetryCount,
      };
      await appendQuestionRecord(runDir, errorRecord);
      return { status: 'error', record: errorRecord };
    }

    try {
      // 1. Retrieve memories via unified_memory_search
      const retrievalStart = Date.now();
      const retrieval = await brainServerClient.unifiedMemorySearch(qa.question, config.retrieval?.top_k || 10);
      const retrievalLatency = Date.now() - retrievalStart;

      // 2. Generate answer via LLM
      let candidateAnswer, answerLatency;
      try {
        const answerResult = await llmClient.answer(qa.question, retrieval, answerPrompt);
        candidateAnswer = answerResult.answer;
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
          candidate_answer: candidateAnswer,
          evidence: retrieval?.results || [],
          subset,
        };
        const judgeOutput = await llmClient.judge(judgeInput, judgePrompt);
        judgeResult = validateJudgeOutput(judgeOutput.metrics);
        judgeLatency = judgeOutput.latencyMs;
        judgeRawResponse = judgeOutput.rawJudgeResponse;
      } catch (judgeErr) {
        judgeRetryCount++;
        throw new Error(`Judge failed: ${judgeErr.message}`);
      }

      // 4. Validate all metrics present (missing metric → error)
      validateAllMetricsPresent(judgeResult);

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
        retrieval_count: retrieval?.results?.length || 0,
        evidence_ids: retrieval?.results?.map((e) => e.id).filter(Boolean) || [],
        judge_raw: judgeRawResponse,
        metrics: judgeResult,
        retrieval_latency_ms: retrievalLatency,
        answer_latency_ms: answerLatency,
        judge_latency_ms: judgeLatency,
        total_latency_ms: retrievalLatency + answerLatency + judgeLatency,
        answer_retry_count: answerRetryCount,
        judge_retry_count: judgeRetryCount,
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
}) {
  if (!llmClient) throw new Error('llmClient is required (LLMClient instance) — null is forbidden');
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
  validateManifest(manifest);
  await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });

  const stats = await runQuestions({
    llmClient, datasetPath, config, answerPrompt, judgePrompt,
    split, conversationIds, runDir, runtimeFactory, brainServerRoot,
    resumeRuntime: false,
  });

  // Update manifest with completion status
  const finalStatus = (stats.errors > 0 || stats.skipped > 0) && stats.done < stats.total ? 'partial' : 'completed';
  await updateManifest(runDir, {
    completed_at: new Date().toISOString(),
    status: isShutdownRequested() ? 'interrupted' : finalStatus,
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
  if (!llmClient) throw new Error('llmClient is required');

  const runDir = await findRunDir(runsRoot, runId);
  const { manifest } = await readRun(runDir);

  // Verify config and prompt match the existing run
  verifyResumeConfig(manifest, config, answerPrompt);

  // Resume: skip completed, re-run errors and remaining
  const stats = await runQuestions({
    llmClient, datasetPath, config, answerPrompt, judgePrompt,
    split: manifest.split,
    conversationIds: manifest.conversation_ids,
    runDir, runtimeFactory, brainServerRoot, resumeRuntime: true,
  });

  const finalStatus = (stats.errors > 0 || stats.skipped > 0) && stats.done < stats.total ? 'partial' : 'completed';
  await updateManifest(runDir, {
    completed_at: new Date().toISOString(),
    status: isShutdownRequested() ? 'interrupted' : finalStatus,
    resumed_at: new Date().toISOString(),
  });

  return { runDir, manifest: { ...manifest, status: finalStatus }, stats };
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
  if (!llmClient) throw new Error('llmClient is required');

  const runDir = await findRunDir(runsRoot, runId);
  const { manifest } = await readRun(runDir);

  // Verify config and prompt match
  verifyResumeConfig(manifest, config, answerPrompt);

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
    assertConversationAllowed({ split: manifest.split, conversationId: convId });
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
        });

        if (result.status === 'completed') done++;
        else errors++;
        retries += result.record.answer_retry_count + result.record.judge_retry_count;
      }
    } finally {
      const stopped = await runtime.stop();
      await recordRuntimeResult(runDir, convId, stopped);
    }
  }

  await updateManifest(runDir, {
    completed_at: new Date().toISOString(),
    status: errors > 0 ? 'partial' : 'completed',
    retried_at: new Date().toISOString(),
  });

  return {
    runDir,
    manifest: { ...manifest, status: errors > 0 ? 'partial' : 'completed' },
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
}) {
  const completed = await completedQuestionIds(runDir);

  let total = 0;
  let done = 0;
  let errors = 0;
  let retries = 0;
  let skipped = 0;

  for (const convId of conversationIds) {
    assertConversationAllowed({ split, conversationId: convId });

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
        const ingestionRecord = {
          schema_version: 1,
          conversation_id: Number(convId),
          status: ingestResult.failed === 0 ? 'completed' : 'failed',
          completed_at: new Date().toISOString(),
          ...ingestResult,
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
        });

        retries += result.record.answer_retry_count + result.record.judge_retry_count;
        if (result.status === 'completed') {
          done++;
          const acc = result.record.metrics?.binary_accuracy === 1;
          if (done % 10 === 0 || qi === qas.length - 1) {
            console.log(`[benchmark] ${qid} [${done}/${total}] ${acc ? 'PASS' : 'FAIL'} (retrieval: ${result.record.retrieval_count}, ${result.record.retrieval_latency_ms}ms)`);
          }
        } else {
          errors++;
        }
      }
    } finally {
      const stopped = await runtime.stop();
      await recordRuntimeResult(runDir, convId, stopped);
    }

    if (isShutdownRequested()) break;
  }

  return { total, done, errors, retries, skipped };
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
