import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConversationRuntime } from '../../benchmark/src/conversation-runtime.mjs';
import { CognitiveProvider, evidenceSourceAgents } from '../../benchmark/cognitive/src/provider.mjs';
import {
  buildLongMemEvalQuestionEnvelope,
  QUESTION_ENVELOPE_VERSION,
  QUESTION_ENVELOPE_SHA256,
} from '../adapters/longmemeval.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '../..');

const EXPECTED_PRODUCT_COMMIT = '17dc1d0107b0474de84058205a91b302ba290a74';
const EXPECTED_PROMPT_SHA256 = '4eb58be8c29f789618fc15f1da3d7c22d3a36c70de549d559c2bb8fefbb5fd21';
const EXPECTED_SELECTOR_VERSION = 'evidence-selector-v2';

function defaultRandomId() {
  return randomBytes(16).toString('hex');
}

function serializeSession(session) {
  const lines = [`[SESSION ${session.session_id}]`, `Timestamp: ${session.timestamp}`];
  for (const message of session.messages) {
    lines.push(`${message.role}: ${message.content}`);
  }
  return lines.join('\n');
}

export async function createEngineWithDeps({ productCommit, isolatedDatabase, dynamicPort, deps }) {
  if (productCommit !== EXPECTED_PRODUCT_COMMIT) {
    throw new Error('ENGINE_PRODUCT_COMMIT_MISMATCH');
  }
  if (isolatedDatabase !== true) {
    throw new Error('ENGINE_ISOLATED_DATABASE_REQUIRED');
  }
  if (dynamicPort !== true) {
    throw new Error('ENGINE_DYNAMIC_PORT_REQUIRED');
  }

  const resolvedDeps = {
    createConversationRuntime,
    CognitiveProvider,
    evidenceSourceAgents,
    randomId: defaultRandomId,
    buildEnvelope: buildLongMemEvalQuestionEnvelope,
    envelopeVersion: QUESTION_ENVELOPE_VERSION,
    envelopeSha256: QUESTION_ENVELOPE_SHA256,
    ...deps,
  };
  const {
    createConversationRuntime: createRuntime,
    CognitiveProvider: Provider,
    evidenceSourceAgents: sourceAgents,
    randomId,
    buildEnvelope,
    envelopeVersion,
    envelopeSha256,
  } = resolvedDeps;

  const brainServerRoot = process.env.OMNI_BRAIN_SERVER_ROOT;
  if (!brainServerRoot) throw new Error('ENGINE_BRAIN_SERVER_ROOT_REQUIRED');

  const externalRunRoot = process.env.OMNI_EXTERNAL_RUN_ROOT;
  if (!externalRunRoot) throw new Error('ENGINE_EXTERNAL_RUN_ROOT_REQUIRED');

  const runDir = path.join(externalRunRoot, 'engine-runs', `${Date.now()}-${randomId()}`);

  const configPath = path.join(REPO_ROOT, 'benchmark', 'cognitive', 'config', 'default.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));

  const promptPath = path.join(REPO_ROOT, 'benchmark', 'cognitive', 'prompts', 'answer-v2.txt');
  const answerPrompt = (await readFile(promptPath, 'utf8')).replace(/\r\n/g, '\n');

  const promptHash = createHash('sha256').update(answerPrompt).digest('hex');
  if (promptHash !== EXPECTED_PROMPT_SHA256) {
    throw new Error('ENGINE_PROMPT_HASH_MISMATCH');
  }

  const provider = new Provider({
    config,
    answerPrompt,
    runRoot: runDir,
    brainServerRoot,
    expectedProductCommit: productCommit,
    expectedSelectorVersion: EXPECTED_SELECTOR_VERSION,
  });

  const runtime = createRuntime({
    runDir,
    conversationId: 1,
    brainServerRoot,
    expectedProductCommit: productCommit,
    expectedSelectorVersion: EXPECTED_SELECTOR_VERSION,
    extraEnv: {
      OMNI_EVALUATION_TRACE_DIR: path.join(runDir, 'conversation-1'),
    },
  });

  await runtime.start();
  await runtime.client.rebuildEmbeddings();
  await runtime.client.preflight();
  const runtimeAttestation = runtime.getAttestation();

  let ingestedSessions = 0;
  let extractionCalls = 0;
  let extractionInputCharacters = 0;
  let firstQueryDone = false;
  let stopped = false;

  async function ingest(session) {
    const serializedText = serializeSession(session);
    await runtime.client.extract(serializedText, `LongMemEval session ${session.session_id}`, {
      timestamp: session.timestamp,
      sessionId: session.session_id,
      evaluationMode: true,
    });
    ingestedSessions++;
    extractionCalls++;
    extractionInputCharacters += serializedText.length;
  }

  async function query({ question, questionDate }) {
    if (!firstQueryDone) {
      await runtime.client.rebuildEmbeddings();
      await runtime.client.preflight();
      firstQueryDone = true;
    }

    // Build the deterministic Question Date Envelope.
    // This envelope is used for BOTH retrieval and the Answer Provider's
    // scenario.question — not just diagnostics.
    const questionEnvelope = buildEnvelope(question, questionDate);

    const retrievalStart = Date.now();
    const retrieval = await runtime.client.unifiedMemorySearch(questionEnvelope, 10);
    const retrievalLatencyMs = Date.now() - retrievalStart;

    const items = (retrieval.finalContext || retrieval.evidence || retrieval.results || []).slice(0, 10);
    const context = items.map((item, index) => {
      const text = item.passage || item.fact || item.description || JSON.stringify(item);
      return {
        source_id: item.evidence_id || item.id || `omni-${index + 1}`,
        text,
        source: 'full_omni',
        source_agents: sourceAgents(item, text),
      };
    });

    // The scenario.question is the envelope (not the original question),
    // so the Answer Provider sees the Current Date context.
    const scenario = {
      scenario_id: randomId(),
      question: questionEnvelope,
    };

    const answerResult = await provider.answer({ scenario, mode: 'full_omni', context });

    return {
      answer: answerResult.structured.answer,
      diagnostics: {
        runtime_attestation: runtimeAttestation,
        original_question: question,
        question_date: questionDate || null,
        question_envelope_version: envelopeVersion,
        question_envelope_sha256: envelopeSha256,
        ingested_sessions: ingestedSessions,
        extraction_calls: extractionCalls,
        extraction_input_characters: extractionInputCharacters,
        retrieval_calls: 1,
        reranker_calls: 1,
        retrieval_latency_ms: retrievalLatencyMs,
        answer_latency_ms: answerResult.latency_ms,
        answer_model: answerResult.model,
        answer_usage: answerResult.usage,
        answer_attempts: answerResult.attempts,
        answer_schema_validation_attempts: answerResult.schema_validation_attempts,
        search_methods: retrieval.searchMethods || {},
        evidence_count: context.length,
        evidence_ids: context.map((x) => x.source_id),
      },
    };
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    try {
      await runtime.stop();
    } catch {
      // Swallow errors to ensure stop() is robust and idempotent even if
      // ingest/query failed and left the runtime in a bad state.
    }
  }

  return { ingest, query, stop };
}

export async function createEngine({ productCommit, isolatedDatabase, dynamicPort }) {
  return createEngineWithDeps({
    productCommit,
    isolatedDatabase,
    dynamicPort,
    deps: {
      createConversationRuntime,
      CognitiveProvider,
      evidenceSourceAgents,
      randomId: defaultRandomId,
      buildEnvelope: buildLongMemEvalQuestionEnvelope,
      envelopeVersion: QUESTION_ENVELOPE_VERSION,
      envelopeSha256: QUESTION_ENVELOPE_SHA256,
    },
  });
}
