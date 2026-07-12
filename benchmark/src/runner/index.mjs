import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256, sha256File, configHash, stableStringify, assertEvaluationEmbeddingMode } from '../integrity.mjs';
import { loadLoCoMo, verifyDatasetHash, getConversation, getConversationQAs, getSessions, formatSessionText, generateQuestionId, mapCategory, isAdversarial, isUnanswerable } from '../dataset.mjs';
import { assertConversationAllowed } from '../splits.mjs';
import { createRun, completedQuestionIds, appendQuestionRecord } from '../run-store.mjs';
import { validateJudgeOutput, computeComposite, validateAllMetricsPresent } from './judge/schema.mjs';

const MANIFEST_REQUIRED_FIELDS = [
  'dataset_hash', 'dataset_source_commit', 'benchmark_commit', 'brain_server_commit',
  'answer_model', 'judge_model', 'embedding_model', 'embedding_status',
  'prompt_hash', 'config_hash', 'node_version', 'os', 'split',
  'conversation_ids', 'run_id', 'started_at', 'completed_at',
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
  const sessions = getSessions(conv);
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
 * Run the benchmark against a real Brain Server with real LLM answer + judge.
 *
 * Required parameters:
 * - brainServerClient: BrainServerClient instance (connected to running Brain Server)
 * - llmClient: LLMClient instance (configured with LLM_API_URL + model)
 * - datasetPath: path to official locomo10.json
 * - config: benchmark config object
 * - answerPrompt: system prompt for answer model
 * - judgePrompt: system prompt for judge model
 * - datasetManifest: dataset metadata with sha256 hash
 * - split: 'development' | 'heldout'
 * - conversationIds: array of conversation IDs to run (e.g., [1])
 * - runsRoot: directory to store run results
 */
export async function runBenchmark({
  brainServerClient,
  llmClient,
  datasetPath,
  config,
  answerPrompt,
  judgePrompt,
  datasetManifest,
  split,
  conversationIds,
  runsRoot,
}) {
  if (!brainServerClient) throw new Error('brainServerClient is required (BrainServerClient instance)');
  if (!llmClient) throw new Error('llmClient is required (LLMClient instance) — null is forbidden');

  // Pre-flight checks: Brain Server health, embedding status, DB writability
  const preflight = await brainServerClient.preflight();
  const embeddingStatus = {
    mode: preflight.embeddingStatus.mode,
    model: preflight.embeddingStatus.model,
    available: preflight.embeddingStatus.healthy,
    status: preflight.embeddingStatus.status,
  };
  assertEvaluationEmbeddingMode(embeddingStatus);

  // Load dataset
  const dataset = await loadLoCoMo(datasetPath);
  const datasetHash = await verifyDatasetHash(datasetPath, datasetManifest.sha256);

  // Create run directory
  const runId = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(runsRoot, runId);
  await mkdir(runDir, { recursive: true });

  // Write manifest
  const manifest = await buildManifest({
    datasetPath, config, answerPrompt, judgePrompt,
    datasetManifest, split, conversationIds, runId, embeddingStatus,
  });
  validateManifest(manifest);
  await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(runDir, 'results.jsonl'), '', { flag: 'wx' });

  // Track completed questions for resume support
  const completed = await completedQuestionIds(runDir);

  let total = 0;
  let done = 0;
  let errors = 0;
  let retries = 0;
  let skipped = 0;

  for (const convId of conversationIds) {
    assertConversationAllowed({ split, conversationId: convId });

    const conv = getConversation(dataset, convId);

    // Ingest conversation sessions via real GraphRAG extraction
    console.log(`[benchmark] Ingesting conversation ${convId}...`);
    const ingestResult = await ingestConversation(brainServerClient, conv, convId);
    console.log(`[benchmark] Ingestion complete: ${ingestResult.ingested}/${ingestResult.total_sessions} sessions, ` +
      `${ingestResult.total_entities} entities, ${ingestResult.total_relationships} relationships, ` +
      `${ingestResult.failed} failed`);

    const qas = getConversationQAs(dataset, convId);
    total += qas.length;

    for (let qi = 0; qi < qas.length; qi++) {
      const qa = qas[qi];
      const qid = generateQuestionId(convId, qa, qi);
      const adversarial = isAdversarial(qa);
      const subset = adversarial ? 'adversarial' : 'answerable';
      const categoryName = mapCategory(qa.category);

      // Skip already-completed questions (resume support)
      if (completed.has(qid)) {
        skipped++;
        continue;
      }

      try {
        // 1. Retrieve memories via unified_memory_search
        const retrievalStart = Date.now();
        const retrieval = await brainServerClient.unifiedMemorySearch(qa.question, config.retrieval?.top_k || 10);
        const retrievalLatency = Date.now() - retrievalStart;

        // 2. Generate answer via LLM
        const { answer: candidateAnswer, latencyMs: answerLatency } = await llmClient.answer(
          qa.question, retrieval, answerPrompt
        );

        // 3. Judge the answer via LLM
        let judgeResult = null;
        let judgeLatency = 0;
        let judgeRawResponse = null;
        let answerRetryCount = 0;
        let judgeRetryCount = 0;

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
          console.error(`[benchmark] Judge failed for ${qid}: ${judgeErr.message}`);
          judgeRetryCount++;
          // Judge failure means the question is an error, not completed
          throw new Error(`Judge failed: ${judgeErr.message}`);
        }

        // 4. Save result to JSONL
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
        completed.add(qid);
        done++;

        if (done % 10 === 0 || qi === qas.length - 1) {
          const acc = judgeResult.binary_accuracy === 1;
          console.log(`[benchmark] ${qid} [${done}/${total}] ${acc ? '✓' : '✗'} (retrieval: ${retrieval?.results?.length || 0} results, ${retrievalLatency}ms)`);
        }
      } catch (err) {
        errors++;
        const record = {
          question_id: qid,
          conversation_id: convId,
          status: 'error',
          subset,
          category: qa.category,
          category_name: categoryName,
          question: qa.question,
          reference_answer: qa.answer,
          error: err instanceof Error ? err.message : String(err),
          error_type: err instanceof Error ? err.constructor.name : 'Unknown',
          retry_count: 0,
          recorded_at: new Date().toISOString(),
        };
        await appendQuestionRecord(runDir, record);
      }
    }
  }

  // Update manifest with completion status
  manifest.completed_at = new Date().toISOString();
  manifest.status = errors > 0 && done < total ? 'partial' : 'completed';
  await writeFile(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  return {
    runDir,
    manifest,
    stats: {
      total,
      done,
      errors,
      retries,
      skipped,
      ingest: { total_sessions: 0, ingested: 0, failed: 0 },
    },
  };
}
