import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertEvaluationEmbeddingMode } from '../src/integrity.mjs';
import { recomputeMetrics } from '../src/recompute-metrics.mjs';
import { appendQuestionRecord, completedQuestionIds, createRun } from '../src/run-store.mjs';
import { assertConversationAllowed } from '../src/splits.mjs';

test('development split is isolated and held-out is denied before freeze', () => {
  assert.doesNotThrow(() => assertConversationAllowed({ split: 'development', conversationId: 1 }));
  assert.throws(() => assertConversationAllowed({ split: 'development', conversationId: 2 }), /not in the development/);
  assert.throws(() => assertConversationAllowed({ split: 'heldout', conversationId: 2 }), /Held-out access denied/);
});

test('formal evaluation fails fast on hash fallback', () => {
  assert.throws(() => assertEvaluationEmbeddingMode({ available: true, mode: 'hash-fallback', model: 'fallback' }), /forbidden/);
  assert.doesNotThrow(() => assertEvaluationEmbeddingMode({ available: true, mode: 'semantic', model: 'text-embedding-model' }));
});

test('run store checkpoints, resumes, and refuses completed overwrite', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'omni-bench-'));
  const { runDir, manifest } = await createRun({
    runsRoot: root, split: 'development', dataset: { sha256: 'abc' },
    benchmarkCommit: 'bench', brainServerCommit: 'brain', config: { top_k: 10 },
    prompt: 'judge', embeddingStatus: { available: true, mode: 'semantic', model: 'test' },
  });
  assert.equal(manifest.split, 'development');
  await appendQuestionRecord(runDir, { question_id: 'c1-q1', status: 'retry', retry_count: 1, error: 'transient' });
  await appendQuestionRecord(runDir, {
    question_id: 'c1-q1', status: 'completed', subset: 'answerable', retry_count: 1,
    raw_judge_output: '{"binary_correct":true}', metrics: { binary_accuracy: 1, factual_score: 0.8 },
  });
  assert.deepEqual([...await completedQuestionIds(runDir)], ['c1-q1']);
  await assert.rejects(() => appendQuestionRecord(runDir, { question_id: 'c1-q1', status: 'completed' }), /overwrite/);
  const lines = (await readFile(path.join(runDir, 'conversation-1', 'results.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
});

test('metrics are independently recomputed with named subsets and retries', () => {
  const metrics = recomputeMetrics([
    { status: 'retry' },
    { status: 'error' },
    { status: 'completed', subset: 'answerable', category_name: 'single_hop', conversation_id: 1, metrics: { binary_accuracy: 1, factual_score: 0.8, temporal_score: 0.6, contextual_score: 1, abstention_accuracy: 1, evidence_precision: 0.5, stale_memory_leakage: 0, latency_ms: 20 } },
    { status: 'completed', subset: 'adversarial', category_name: 'adversarial', conversation_id: 1, metrics: { binary_accuracy: 0, factual_score: 0.2, temporal_score: 0.4, contextual_score: 0, abstention_accuracy: 1, evidence_precision: 0.5, stale_memory_leakage: 0.5, latency_ms: 40 } },
  ]);
  assert.equal(metrics.binary_accuracy, 0.5);
  assert.equal(metrics.subsets.answerable.binary_accuracy, 1);
  assert.equal(metrics.subsets.adversarial.binary_accuracy, 0);
  assert.equal(metrics.questions_error, 1);
  assert.equal(metrics.questions_completed, 2);
  assert.ok(metrics.composite > 0 && metrics.composite < 1);
});
