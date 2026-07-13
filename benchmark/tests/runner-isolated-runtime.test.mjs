import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumeBenchmark, runBenchmark } from '../src/runner/index.mjs';
import { ConversationRuntime } from '../src/conversation-runtime.mjs';
import { sha256File } from '../src/integrity.mjs';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_SERVER = path.join(TEST_DIR, 'fixtures', 'fake-brain-server.mjs');

describe('production runner owns an isolated conversation runtime', () => {
  let root;
  let datasetPath;

  before(async () => {
    const runsBase = path.join(TEST_DIR, '..', 'runs');
    await mkdir(runsBase, { recursive: true });
    root = await mkdtemp(path.join(runsBase, 'runner-isolation-'));
    datasetPath = path.join(root, 'locomo10.json');
    await writeFile(datasetPath, JSON.stringify([{
      sample_id: 1,
      conversation: {
        speaker_a: 'Alice', speaker_b: 'Bob',
        session_1: [{ speaker: 'A', text: 'Alice lives in Shanghai.' }],
        session_1_date_time: '7:48 pm on 21 May, 2023',
      },
      qa: [{ question: 'Where does Alice live?', answer: 'Shanghai', category: 1, evidence: ['D1:1'] }],
    }]));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates the required run layout, closes the process, and hashes the DB', async () => {
    const datasetHash = await sha256File(datasetPath);
    const llmClient = {
      async answer() { return { answer: 'Shanghai', latencyMs: 1 }; },
      async judge() {
        return {
          metrics: {
            binary_accuracy: 1,
            factual_score: 1,
            temporal_score: 1,
            contextual_score: 1,
            abstention_accuracy: 1,
            evidence_precision: 1,
            stale_memory_leakage: 0,
            rationale: 'fixture answer is exact',
          },
          latencyMs: 1,
          rawJudgeResponse: '{"fixture":true}',
        };
      },
    };
    const runtimeFactory = (options) => new ConversationRuntime({
      ...options,
      brainServerRoot: TEST_DIR,
      serverEntry: FAKE_SERVER,
      startupTimeoutMs: 10_000,
      shutdownTimeoutMs: 5_000,
    });

    const result = await runBenchmark({
      llmClient,
      datasetPath,
      config: { retrieval: { top_k: 10 }, benchmark_commit: 'fixture', brain_server_commit: 'fixture' },
      answerPrompt: 'answer fixture',
      judgePrompt: 'judge fixture',
      datasetManifest: { sha256: datasetHash, source_commit: 'fixture' },
      split: 'development',
      conversationIds: [1],
      runsRoot: root,
      runtimeFactory,
    });

    const conversationDir = path.join(result.runDir, 'conversation-1');
    await Promise.all([
      access(path.join(conversationDir, 'brain.db')),
      access(path.join(conversationDir, 'server.log')),
      access(path.join(conversationDir, 'server.pid')),
      access(path.join(conversationDir, 'ingestion.json')),
      access(path.join(conversationDir, 'extraction-diagnostics.jsonl')),
      access(path.join(conversationDir, 'results.jsonl')),
      access(path.join(conversationDir, 'database-hash.txt')),
    ]);
    await assert.rejects(() => access(path.join(result.runDir, 'results.jsonl')));

    const manifest = JSON.parse(await readFile(path.join(result.runDir, 'manifest.json'), 'utf8'));
    const runtime = JSON.parse(await readFile(path.join(conversationDir, 'runtime.json'), 'utf8'));
    const ingestion = JSON.parse(await readFile(path.join(conversationDir, 'ingestion.json'), 'utf8'));
    const extractionDiagnostics = JSON.parse((await readFile(
      path.join(conversationDir, 'extraction-diagnostics.jsonl'), 'utf8'
    )).trim());
    assert.strictEqual(manifest.status, 'completed');
    assert.match(manifest.conversation_databases['1'].sha256, /^[a-f0-9]{64}$/);
    assert.strictEqual(runtime.status, 'stopped');
    assert.strictEqual(ingestion.status, 'completed');
    assert.deepStrictEqual(extractionDiagnostics.dataset_timestamp, {
      raw_timestamp: '7:48 pm on 21 May, 2023',
      parsed_timestamp: '2023-05-21T19:48:00.000Z',
      parser_version: 'locomo-datetime-v2',
      timezone_assumption: 'UTC for LoCoMo timestamps without an explicit timezone',
    });
    assert.strictEqual(extractionDiagnostics.timestamp, '2023-05-21T19:48:00.000Z');
    assert.strictEqual(extractionDiagnostics.evaluation_mode, true);
    assert.strictEqual(extractionDiagnostics.extraction.llm_calls[0].http_status, 200);
    assert.match(extractionDiagnostics.extraction.llm_calls[0].raw_response_sha256, /^[a-f0-9]{64}$/);
    assert.strictEqual(result.stats.total, 1);
    assert.strictEqual(result.stats.done, 1);

    const resumed = await resumeBenchmark({
      llmClient,
      datasetPath,
      config: { retrieval: { top_k: 10 }, benchmark_commit: 'fixture', brain_server_commit: 'fixture' },
      answerPrompt: 'answer fixture',
      judgePrompt: 'judge fixture',
      datasetManifest: { sha256: datasetHash, source_commit: 'fixture' },
      runsRoot: root,
      runId: manifest.run_id,
      runtimeFactory,
    });
    const persistedDb = JSON.parse(await readFile(path.join(conversationDir, 'brain.db'), 'utf8'));
    assert.strictEqual(resumed.stats.skipped, 1);
    assert.strictEqual(persistedDb.entities.length, 1, 'resume must not re-ingest completed conversation');
  });
});
