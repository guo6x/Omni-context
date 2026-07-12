import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configHash, sha256 } from './integrity.mjs';

function safeTimestamp(date = new Date()) {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

export async function createRun({
  runsRoot,
  split,
  dataset,
  benchmarkCommit,
  brainServerCommit,
  config,
  prompt,
  embeddingStatus,
  now = new Date(),
}) {
  const runId = `${safeTimestamp(now)}-${randomUUID()}`;
  const runDir = path.join(runsRoot, runId);
  await mkdir(runDir, { recursive: false });
  const manifest = {
    schema_version: 1,
    run_id: runId,
    created_at: now.toISOString(),
    split,
    dataset,
    benchmark_commit: benchmarkCommit,
    brain_server_commit: brainServerCommit,
    config_hash: configHash(config),
    prompt_hash: sha256(prompt),
    embedding_status: embeddingStatus,
    status: 'running',
  };
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(runDir, 'results.jsonl'), '', { flag: 'wx' });
  return { runDir, manifest };
}

export async function readRun(runDir) {
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  const raw = await readFile(path.join(runDir, 'results.jsonl'), 'utf8');
  const records = raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`Invalid JSONL at line ${index + 1}: ${error.message}`); }
  });
  return { manifest, records };
}

export async function completedQuestionIds(runDir) {
  const { records } = await readRun(runDir);
  return new Set(records.filter((record) => record.status === 'completed').map((record) => record.question_id));
}

export async function appendQuestionRecord(runDir, record) {
  if (!record?.question_id || !['completed', 'error', 'retry'].includes(record.status)) {
    throw new Error('A benchmark record needs question_id and status completed, error, or retry.');
  }
  const completed = await completedQuestionIds(runDir);
  if (record.status === 'completed' && completed.has(record.question_id)) {
    throw new Error(`Refusing to overwrite completed question ${record.question_id}.`);
  }
  const line = `${JSON.stringify({ recorded_at: new Date().toISOString(), ...record })}\n`;
  const handle = await open(path.join(runDir, 'results.jsonl'), 'a');
  try {
    await handle.write(line);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
