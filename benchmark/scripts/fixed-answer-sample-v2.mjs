import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LLMClient } from '../src/llm-client.mjs';
import { BrainServerClient } from '../src/brain-server-client.mjs';
import { createConversationRuntime } from '../src/conversation-runtime.mjs';
import { loadLoCoMoConversation } from '../src/dataset.mjs';
import { processQuestion, clearShutdownRequest } from '../src/runner/index.mjs';
import { computeStatistics } from '../src/judge/schema.mjs';
import { configHash, sha256, sha256File, stableStringify } from '../src/integrity.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK_ROOT = path.resolve(HERE, '..');

function argsFrom(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${item} requires a value`);
    args[item.slice(2)] = value;
    index++;
  }
  return args;
}

function required(args, name) {
  const value = String(args[name] || '').trim();
  if (!value) throw new Error(`--${name} is required`);
  return path.resolve(value);
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchScore(spanText, turnText) {
  const span = normalize(spanText);
  const turn = normalize(turnText);
  if (!span || !turn) return 0;
  if (span.length >= 8 && (span.includes(turn) || turn.includes(span))) return 1;
  const a = new Set(span.split(' ').filter((word) => word.length > 2));
  const b = new Set(turn.split(' ').filter((word) => word.length > 2));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((word) => b.has(word)).length;
  return overlap / (a.size + b.size - overlap);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))].toFixed(2));
}

function latestCompleted(lines) {
  const byQuestion = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.status === 'completed') byQuestion.set(String(row.question_id), row);
  }
  return byQuestion;
}

function flattenSelection(sample) {
  return Object.values(sample.question_ids).flat().map(String);
}

function goldPresence(records, qaById, turnById) {
  const rows = [];
  for (const record of records) {
    const qa = qaById.get(record.question_id);
    const gold = (qa?.evidence || []).map(String);
    const spans = (record.evidence || [])
      .filter((evidence) => evidence.type === 'assertion' && evidence.source_span)
      .map((evidence) => String(evidence.source_span));
    const covered = gold.filter((id) => {
      const turn = turnById.get(id);
      return Boolean(turn && spans.some((span) => matchScore(span, turn) >= 0.5));
    });
    rows.push({
      question_id: record.question_id,
      category: record.category_name,
      present: covered.length > 0,
      covered_gold: covered,
      correct: Number(record.metrics?.binary_accuracy || 0),
    });
  }
  const present = rows.filter((row) => row.present);
  return {
    total: rows.length,
    present_count: present.length,
    recall: rows.length ? Number((present.length / rows.length).toFixed(4)) : 0,
    accuracy_when_present: present.length
      ? Number((present.reduce((sum, row) => sum + row.correct, 0) / present.length).toFixed(4))
      : 0,
    rows,
  };
}

async function main() {
  clearShutdownRequest();
  const args = argsFrom(process.argv.slice(2));
  const sourceDb = required(args, 'db');
  const datasetPath = required(args, 'dataset');
  const samplePath = required(args, 'sample');
  const v1ResultsPath = required(args, 'v1-results');
  const outputDir = required(args, 'output');
  const brainServerRoot = required(args, 'brain-server-root');
  const modelRoot = required(args, 'model-root');
  await access(outputDir).then(() => { throw new Error(`Output already exists: ${outputDir}`); }).catch((error) => {
    if (error?.message?.startsWith('Output already exists:')) throw error;
  });
  await mkdir(path.join(outputDir, 'conversation-1'), { recursive: true });

  const [sample, config, answerPrompt, judgePrompt, conversation] = await Promise.all([
    readFile(samplePath, 'utf8').then(JSON.parse),
    readFile(path.join(BENCHMARK_ROOT, 'config', 'default.json'), 'utf8').then(JSON.parse),
    readFile(path.join(BENCHMARK_ROOT, 'prompts', 'answer-v2.txt'), 'utf8'),
    readFile(path.join(BENCHMARK_ROOT, 'prompts', 'judge-v2.txt'), 'utf8'),
    loadLoCoMoConversation(datasetPath, 1),
  ]);
  const selectedIds = flattenSelection(sample);
  if (selectedIds.length !== 53 || new Set(selectedIds).size !== 53) throw new Error('Fixed sample must contain 53 unique IDs');
  if (sample.conversation_ids?.length !== 1 || Number(sample.conversation_ids[0]) !== 1) {
    throw new Error('Fixed sample is not restricted to Conversation 1');
  }
  for (const name of ['LLM_MODEL', 'ANSWER_MODEL', 'JUDGE_MODEL']) {
    if (String(process.env[name] || '') !== 'deepseek-v4-flash') throw new Error(`${name} must be deepseek-v4-flash`);
  }
  if ((config.evaluation?.thinking_mode || process.env.LLM_THINKING_MODE) !== 'disabled') {
    throw new Error('Thinking must be disabled');
  }
  if (!process.env.LLM_API_KEY) throw new Error('LLM_API_KEY is required through the environment');

  const qaById = new Map(conversation.qa.map((qa, index) => [`conv1-q${index}`, qa]));
  const turnById = new Map();
  for (const [key, value] of Object.entries(conversation.conversation)) {
    if (!/^session_\d+$/.test(key) || !Array.isArray(value)) continue;
    for (const turn of value) turnById.set(String(turn.dia_id), String(turn.text || ''));
  }
  const missing = selectedIds.filter((id) => !qaById.has(id));
  if (missing.length) throw new Error(`Fixed sample IDs not found: ${missing.join(', ')}`);

  const runId = path.basename(outputDir);
  const dbPath = path.join(outputDir, 'conversation-1', 'brain.db');
  await copyFile(sourceDb, dbPath);
  const manifest = {
    schema_version: 1,
    run_id: runId,
    run_type: 'fixed-answer-sample-v2',
    status: 'running',
    split: 'development',
    conversation_ids: [1],
    conversation1_content_sha256: sha256(JSON.stringify(conversation)),
    source_database_sha256: await sha256File(sourceDb),
    question_set_sha256: sha256(stableStringify(sample)),
    question_ids: selectedIds,
    answer_model: 'deepseek-v4-flash',
    judge_model: 'deepseek-v4-flash',
    thinking_mode: 'disabled',
    embedding_model: 'Xenova/multilingual-e5-large',
    embedding_dimension: 1024,
    prompt_hash: sha256(answerPrompt),
    judge_prompt_hash: sha256(judgePrompt),
    config_hash: configHash(config),
    started_at: new Date().toISOString(),
  };
  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });

  const llmClient = new LLMClient({
    thinkingMode: 'disabled',
    answerMaxTokens: config.evaluation.answer_max_tokens,
    judgeMaxTokens: config.evaluation.judge_max_tokens,
  });
  const runtime = createConversationRuntime({
    runDir: outputDir,
    conversationId: 1,
    resume: true,
    brainServerRoot,
    extraEnv: {
      EMBEDDING_MODE: 'local',
      EMBEDDING_LOCAL_MODEL: 'Xenova/multilingual-e5-large',
      EMBEDDING_LOCAL_MODEL_PATH: modelRoot,
      TRANSFORMERS_OFFLINE: '1',
      LLM_THINKING_MODE: 'disabled',
      INSIGHT_INTERVAL_MS: '3600000',
    },
  });

  let preflight;
  let stopped;
  const outcomes = [];
  try {
    await runtime.start();
    const client = new BrainServerClient({ baseUrl: `http://127.0.0.1:${runtime.port}`, token: runtime.token });
    preflight = await client.preflight();
    if (preflight.embeddingStatus?.dimensions !== 1024 && preflight.embeddingStatus?.actualDimension !== 1024) {
      throw new Error(`Embedding preflight is not 1024-dimensional: ${JSON.stringify(preflight.embeddingStatus)}`);
    }
    for (let index = 0; index < selectedIds.length; index++) {
      const qid = selectedIds[index];
      process.stdout.write(`${JSON.stringify({ event: 'fixed_sample_question_start', done: index, total: selectedIds.length, question_id: qid })}\n`);
      const outcome = await processQuestion({
        brainServerClient: client,
        llmClient,
        qa: qaById.get(qid),
        qid,
        convId: 1,
        config,
        answerPrompt,
        judgePrompt,
        runDir: outputDir,
        maxRetries: config.evaluation.max_retries,
      });
      outcomes.push(outcome);
      process.stdout.write(`${JSON.stringify({ event: 'fixed_sample_question_complete', done: index + 1, total: selectedIds.length, question_id: qid, status: outcome.status })}\n`);
    }
  } finally {
    stopped = await runtime.stop().catch((error) => ({ error: error.message }));
  }

  const resultPath = path.join(outputDir, 'conversation-1', 'results.jsonl');
  const v2Lines = (await readFile(resultPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  const v2Map = latestCompleted(v2Lines);
  const v2Records = selectedIds.map((id) => v2Map.get(id)).filter(Boolean);
  const v1Lines = (await readFile(v1ResultsPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean);
  const v1Map = latestCompleted(v1Lines);
  const v1Records = selectedIds.map((id) => v1Map.get(id)).filter(Boolean);
  const metrics = computeStatistics(v2Records);
  const recomputedMetrics = computeStatistics(v2Records);
  const v1Metrics = computeStatistics(v1Records);
  const v1Presence = goldPresence(v1Records, qaById, turnById);
  const v2Presence = goldPresence(v2Records, qaById, turnById);
  const completed = v2Records.length;
  const errors = outcomes.filter((outcome) => outcome.status === 'error').length;

  const comparison = {
    question_set_sha256: manifest.question_set_sha256,
    v1: { completed: v1Records.length, metrics: v1Metrics, gold_evidence_present: v1Presence },
    v2: { completed, errors, metrics, gold_evidence_present: v2Presence },
    latency_ms: {
      retrieval_p50: percentile(v2Records.map((row) => row.retrieval_latency_ms), 0.5),
      retrieval_p95: percentile(v2Records.map((row) => row.retrieval_latency_ms), 0.95),
      answer_p50: percentile(v2Records.map((row) => row.answer_latency_ms), 0.5),
      answer_p95: percentile(v2Records.map((row) => row.answer_latency_ms), 0.95),
      total_p50: percentile(v2Records.map((row) => row.total_latency_ms), 0.5),
      total_p95: percentile(v2Records.map((row) => row.total_latency_ms), 0.95),
    },
  };
  const candidateSnapshots = v2Records.map((record) => JSON.stringify({
    question_id: record.question_id,
    category: record.category_name,
    candidates: record.candidate_pool || [],
    search_methods: record.search_methods || {},
    fusion_config: record.fusion_config || null,
  })).join('\n');
  const contextSnapshots = v2Records.map((record) => JSON.stringify({
    question_id: record.question_id,
    category: record.category_name,
    final_context: record.final_context || [],
    evidence: record.evidence || [],
  })).join('\n');
  await Promise.all([
    writeFile(path.join(outputDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`),
    writeFile(path.join(outputDir, 'recomputed-metrics.json'), `${JSON.stringify(recomputedMetrics, null, 2)}\n`),
    writeFile(path.join(outputDir, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`),
    writeFile(path.join(outputDir, 'candidate-snapshots.jsonl'), `${candidateSnapshots}\n`),
    writeFile(path.join(outputDir, 'final-context-snapshots.jsonl'), `${contextSnapshots}\n`),
  ]);
  const finalManifest = {
    ...manifest,
    status: errors === 0 && completed === selectedIds.length ? 'completed' : 'failed',
    completed_at: new Date().toISOString(),
    completed_questions: completed,
    errors,
    embedding_status: preflight?.embeddingStatus || null,
    stopped,
    brain_db_sha256: await sha256File(dbPath),
    brain_db_bytes: (await stat(dbPath)).size,
    metrics_recompute_consistent: stableStringify(metrics) === stableStringify(recomputedMetrics),
  };
  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(finalManifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'fixed_answer_sample_complete', outputDir, status: finalManifest.status, completed, errors, comparison })}\n`);
  if (finalManifest.status !== 'completed') process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ event: 'fixed_answer_sample_failed', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
