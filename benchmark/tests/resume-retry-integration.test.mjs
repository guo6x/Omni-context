import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestShutdown, resumeBenchmark, retryErrors, runBenchmark } from '../src/runner/index.mjs';
import { ConversationRuntime } from '../src/conversation-runtime.mjs';
import { sha256File } from '../src/integrity.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_SERVER = path.join(TEST_DIR, 'fixtures', 'fake-brain-server.mjs');
const METRICS = {
  binary_accuracy: 1,
  factual_score: 1,
  temporal_score: 1,
  contextual_score: 1,
  abstention_accuracy: 1,
  claim_evaluations: [{ claim_index: 0, evidence_id: 'extracted-1', verdict: 'supports', used_in_answer: true }],
  rationale: 'deterministic integration fixture',
};

function healthyAnswer(answer = 'fixture') {
  const structuredAnswer = {
    answer, claims: [{ text: answer, evidence_ids: ['extracted-1'] }],
    abstained: false, abstention_reason: null,
  };
  return { answer, structuredAnswer, rawAnswerResponse: JSON.stringify(structuredAnswer), latencyMs: 1 };
}

function runtimeFactory(options) {
  return new ConversationRuntime({
    ...options,
    brainServerRoot: TEST_DIR,
    serverEntry: FAKE_SERVER,
    startupTimeoutMs: 10_000,
    shutdownTimeoutMs: 5_000,
  });
}

function healthyJudge() {
  return { metrics: METRICS, latencyMs: 1, rawJudgeResponse: '{"fixture":true}' };
}

async function recordsFor(runDir) {
  const raw = await readFile(path.join(runDir, 'conversation-1', 'results.jsonl'), 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

describe('real runner resume and retry state machine', () => {
  let root;
  let datasetPath;
  let datasetManifest;
  const config = {
    retrieval: { top_k: 10 },
    retry: { max_retries: 0, base_backoff_ms: 0 },
    benchmark_commit: 'fixture',
    brain_server_commit: 'fixture',
  };

  before(async () => {
    const runsBase = path.join(TEST_DIR, '..', 'runs');
    await mkdir(runsBase, { recursive: true });
    root = await mkdtemp(path.join(runsBase, 'resume-retry-integration-'));
    datasetPath = path.join(root, 'locomo10.json');
    await writeFile(datasetPath, JSON.stringify([{
      sample_id: 1,
      conversation: {
        speaker_a: 'Alice', speaker_b: 'Bob',
        session_1: [{ speaker: 'A', text: 'Alice lives in Shanghai.' }],
        session_1_date_time: '7:48 pm on 21 May, 2023',
      },
      qa: [
        { question: 'Question one?', answer: 'one', category: 1, evidence: ['D1:1'] },
        { question: 'Question two?', answer: 'two', category: 1, evidence: ['D1:1'] },
        { question: 'Question three?', answer: 'three', category: 1, evidence: ['D1:1'] },
      ],
    }]));
    datasetManifest = { sha256: await sha256File(datasetPath), source_commit: 'fixture' };
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resumes the same run/database without re-ingestion or duplicate completed records', async () => {
    let answerCalls = 0;
    const interruptedClient = {
      async answer(_question) {
        answerCalls++;
        if (answerCalls === 2) requestShutdown();
        return healthyAnswer();
      },
      async judge() { return healthyJudge(); },
    };
    const initial = await runBenchmark({
      llmClient: interruptedClient, datasetPath, config,
      answerPrompt: 'answer fixture', judgePrompt: 'judge fixture', datasetManifest,
      split: 'development', conversationIds: [1], runsRoot: root, runtimeFactory,
    });
    const initialManifest = JSON.parse(await readFile(path.join(initial.runDir, 'manifest.json'), 'utf8'));
    const beforeRecords = await recordsFor(initial.runDir);
    const beforeDb = JSON.parse(await readFile(path.join(initial.runDir, 'conversation-1', 'brain.db'), 'utf8'));
    assert.strictEqual(initialManifest.status, 'interrupted');
    assert.strictEqual(initialManifest.statistics.interrupted, true);
    assert.strictEqual(initialManifest.statistics.completed_questions, 2);
    assert.strictEqual(beforeRecords.filter((record) => record.status === 'completed').length, 2);

    let resumedAnswers = 0;
    const resumed = await resumeBenchmark({
      llmClient: {
        async answer() { resumedAnswers++; return healthyAnswer(); },
        async judge() { return healthyJudge(); },
      },
      datasetPath, config, answerPrompt: 'answer fixture', judgePrompt: 'judge fixture', datasetManifest,
      runsRoot: root, runId: initialManifest.run_id, runtimeFactory,
    });
    const afterManifest = JSON.parse(await readFile(path.join(initial.runDir, 'manifest.json'), 'utf8'));
    const afterRecords = await recordsFor(initial.runDir);
    const afterDb = JSON.parse(await readFile(path.join(initial.runDir, 'conversation-1', 'brain.db'), 'utf8'));
    const completed = afterRecords.filter((record) => record.status === 'completed');
    assert.strictEqual(resumed.runDir, initial.runDir);
    assert.strictEqual(resumed.manifest.run_id, initialManifest.run_id);
    assert.strictEqual(resumedAnswers, 1);
    assert.deepStrictEqual(resumed.stats, { total: 3, done: 1, errors: 0, retries: 0, skipped: 2, interrupted: false });
    assert.strictEqual(afterManifest.status, 'completed');
    assert.strictEqual(afterManifest.statistics.completed_questions, 3);
    assert.strictEqual(beforeDb.entities.length, 1);
    assert.strictEqual(afterDb.entities.length, 1, 'resume must reuse ingestion and the same database');
    assert.strictEqual(completed.length, 3);
    assert.strictEqual(new Set(completed.map((record) => record.question_id)).size, 3);
  });

  it('retry-errors repairs only latest error questions and derives final status from all records', async () => {
    const failing = await runBenchmark({
      llmClient: {
        async answer(question) { return healthyAnswer(question); },
        async judge(input) {
          if (input.question === 'Question one?') throw new Error('injected judge outage');
          return healthyJudge();
        },
      },
      datasetPath, config, answerPrompt: 'answer fixture', judgePrompt: 'judge fixture', datasetManifest,
      split: 'development', conversationIds: [1], runsRoot: root, runtimeFactory,
    });
    const failingManifest = JSON.parse(await readFile(path.join(failing.runDir, 'manifest.json'), 'utf8'));
    assert.strictEqual(failingManifest.status, 'partial');
    assert.strictEqual(failingManifest.statistics.completed_questions, 2);
    assert.strictEqual(failingManifest.statistics.errors, 1);

    let retriedAnswers = 0;
    const repaired = await retryErrors({
      llmClient: {
        async answer(question) { retriedAnswers++; return healthyAnswer(question); },
        async judge() { return healthyJudge(); },
      },
      datasetPath, config, answerPrompt: 'answer fixture', judgePrompt: 'judge fixture', datasetManifest,
      runsRoot: root, runId: failingManifest.run_id, runtimeFactory,
    });
    const records = await recordsFor(failing.runDir);
    const finalManifest = JSON.parse(await readFile(path.join(failing.runDir, 'manifest.json'), 'utf8'));
    const completed = records.filter((record) => record.status === 'completed');
    assert.strictEqual(retriedAnswers, 1);
    assert.deepStrictEqual(repaired.stats, { total: 1, done: 1, errors: 0, retries: 0, skipped: 0 });
    assert.strictEqual(finalManifest.status, 'completed');
    assert.strictEqual(finalManifest.statistics.completed_questions, 3);
    assert.strictEqual(finalManifest.statistics.errors, 0);
    assert.strictEqual(finalManifest.statistics.duplicate_completed_records, 0);
    assert.strictEqual(completed.length, 3);
    assert.strictEqual(new Set(completed.map((record) => record.question_id)).size, 3);
  });

  it('counts persisted retry records, including a transient judge failure', async () => {
    let judgeCalls = 0;
    const retryConfig = { ...config, retry: { max_retries: 1, base_backoff_ms: 0 } };
    const result = await runBenchmark({
      llmClient: {
        async answer(question) { return healthyAnswer(question); },
        async judge() {
          judgeCalls++;
          if (judgeCalls === 1) throw new Error('single injected judge failure');
          return healthyJudge();
        },
      },
      datasetPath, config: retryConfig, answerPrompt: 'answer fixture', judgePrompt: 'judge fixture', datasetManifest,
      split: 'development', conversationIds: [1], runsRoot: root, runtimeFactory,
    });
    const manifest = JSON.parse(await readFile(path.join(result.runDir, 'manifest.json'), 'utf8'));
    const records = await recordsFor(result.runDir);
    assert.strictEqual(result.stats.retries, 1);
    assert.strictEqual(records.filter((record) => record.status === 'retry').length, 1);
    assert.strictEqual(manifest.statistics.retry_records_this_invocation, 1);
    assert.strictEqual(manifest.status, 'completed');
  });
});
