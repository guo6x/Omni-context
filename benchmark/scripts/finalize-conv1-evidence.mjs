#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getConversationQAs, generateQuestionId, isAdversarial, loadLoCoMoConversation, mapCategory } from '../src/dataset.mjs';
import { computeStatistics } from '../src/judge/schema.mjs';
import { readRun } from '../src/run-store.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const BENCHMARK_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPOSITORY_ROOT = path.resolve(BENCHMARK_ROOT, '..');
const execFileAsync = promisify(execFile);

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

async function writeJson(target, value) {
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

function countBy(values, selector) {
  const counts = {};
  for (const value of values) {
    const key = String(selector(value));
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

async function databaseSummary(dbPath, brainServerRoot) {
  const require = createRequire(path.join(brainServerRoot, 'package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const count = (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    return {
      entities: count('entities'),
      relationships: count('relationships'),
      assertions: count('assertions'),
      principles: db.prepare("SELECT COUNT(*) AS count FROM entities WHERE type = 'principle'").get().count,
      entity_types: Object.fromEntries(
        db.prepare('SELECT type, COUNT(*) AS count FROM entities GROUP BY type ORDER BY type')
          .all().map((row) => [row.type, row.count]),
      ),
    };
  } finally {
    db.close();
  }
}

async function main() {
  const runDir = path.resolve(flag('--run-dir') || '');
  const datasetPath = path.resolve(flag('--dataset') || '');
  const brainServerRoot = path.resolve(flag('--brain-server-root') || path.join(BENCHMARK_ROOT, '..', 'brain-server'));
  if (!flag('--run-dir') || !flag('--dataset')) {
    throw new Error('Usage: finalize-conv1-evidence.mjs --run-dir <dir> --dataset <locomo10.json> [--brain-server-root <dir>]');
  }

  const firstRead = await readRun(runDir);
  let { manifest } = firstRead;
  const { records } = firstRead;
  if (manifest.split !== 'development' || JSON.stringify(manifest.conversation_ids?.map(Number)) !== '[1]') {
    throw new Error('This finalizer refuses any run other than development Conversation 1.');
  }
  const [{ stdout: commitStdout }, { stdout: statusStdout }] = await Promise.all([
    execFileAsync('git', ['-C', REPOSITORY_ROOT, 'rev-parse', 'HEAD']),
    execFileAsync('git', ['-C', REPOSITORY_ROOT, 'status', '--porcelain']),
  ]);
  if (statusStdout.trim()) {
    throw new Error('Refusing to seal run provenance from a dirty repository. Commit the exact implementation first.');
  }
  const implementationCommit = commitStdout.trim();
  manifest = {
    ...manifest,
    benchmark_commit: implementationCommit,
    brain_server_commit: implementationCommit,
    desktop_commit: implementationCommit,
    provenance_sealed_at: new Date().toISOString(),
  };
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const conversation = await loadLoCoMoConversation(datasetPath, 1);
  const qas = getConversationQAs(null, conversation);
  const expectedIds = qas.map((qa, index) => generateQuestionId(1, qa, index));
  const expectedSet = new Set(expectedIds);

  const latest = new Map();
  const completedCounts = new Map();
  for (const record of records) {
    latest.set(record.question_id, record);
    if (record.status === 'completed') {
      completedCounts.set(record.question_id, (completedCounts.get(record.question_id) || 0) + 1);
    }
  }
  const latestValues = [...latest.values()];
  const completedIds = latestValues.filter((record) => record.status === 'completed').map((record) => record.question_id);
  const errorIds = latestValues.filter((record) => record.status === 'error').map((record) => record.question_id);
  const missingIds = expectedIds.filter((id) => !latest.has(id));
  const unexpectedIds = [...latest.keys()].filter((id) => !expectedSet.has(id));
  const duplicateIds = [...completedCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const retryRecords = records.filter((record) => record.status === 'retry').length;

  const metrics = computeStatistics(records);
  const metricsPath = path.join(runDir, 'metrics.json');
  await writeJson(metricsPath, metrics);
  // Independent second disk read is the recomputation boundary.
  const secondRead = await readRun(runDir);
  const recomputed = computeStatistics(secondRead.records);
  const recomputedPath = path.join(runDir, 'recomputed-metrics.json');
  await writeJson(recomputedPath, recomputed);
  const metricsMatch = JSON.stringify(stable(metrics)) === JSON.stringify(stable(recomputed));

  const startedMs = Date.parse(manifest.started_at);
  const completedMs = Date.parse(manifest.completed_at);
  const integrity = {
    schema_version: 1,
    conversation_id: 1,
    expected_questions: expectedIds.length,
    completed_questions: completedIds.length,
    error_questions: errorIds.length,
    retry_records: retryRecords,
    unique_completed_question_ids: new Set(completedIds).size,
    duplicate_question_ids: duplicateIds,
    missing_question_ids: missingIds,
    unexpected_question_ids: unexpectedIds,
    category_counts: countBy(qas, (qa) => mapCategory(qa.category)),
    answerable_count: qas.filter((qa) => !isAdversarial(qa)).length,
    adversarial_count: qas.filter(isAdversarial).length,
    started_at: manifest.started_at,
    completed_at: manifest.completed_at,
    duration_ms: Number.isFinite(startedMs) && Number.isFinite(completedMs) ? completedMs - startedMs : null,
    manifest_status: manifest.status,
    metrics_recompute_exact_match: metricsMatch,
  };
  await writeJson(path.join(runDir, 'question-integrity.json'), integrity);

  const config = JSON.parse(await readFile(path.join(BENCHMARK_ROOT, 'config', 'default.json'), 'utf8'));
  await writeJson(path.join(runDir, 'config-snapshot.json'), {
    config,
    config_hash: manifest.config_hash,
    answer_model: manifest.answer_model,
    judge_model: manifest.judge_model,
    embedding_model: manifest.embedding_model,
    answer_prompt_hash: manifest.prompt_hash,
    judge_prompt_hash: manifest.judge_prompt_hash,
    datetime_parser_version: manifest.datetime_parser_version,
    datetime_timezone_assumption: manifest.datetime_timezone_assumption,
  });

  const ingestion = JSON.parse(await readFile(path.join(runDir, 'conversation-1', 'ingestion.json'), 'utf8'));
  await writeJson(path.join(runDir, 'ingestion-summary.json'), ingestion);
  const dbSummary = await databaseSummary(path.join(runDir, 'conversation-1', 'brain.db'), brainServerRoot);
  await writeJson(path.join(runDir, 'database-summary.json'), dbSummary);

  const summary = {
    run_id: manifest.run_id,
    integrity,
    database: dbSummary,
    metrics_sha256: sha256(await readFile(metricsPath)),
    recomputed_metrics_sha256: sha256(await readFile(recomputedPath)),
  };
  await writeJson(path.join(runDir, 'finalization-summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
