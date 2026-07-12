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

/** Get IDs of questions that ended in error status (candidates for retry). */
export async function errorQuestionIds(runDir) {
  const { records } = await readRun(runDir);
  // A question is an error candidate if its LATEST record is 'error'
  const latestByQid = new Map();
  for (const rec of records) {
    latestByQid.set(rec.question_id, rec);
  }
  return new Set(
    [...latestByQid.values()]
      .filter((r) => r.status === 'error')
      .map((r) => r.question_id)
  );
}

/** Get all question IDs that have been recorded (any status). */
export async function allRecordedQuestionIds(runDir) {
  const { records } = await readRun(runDir);
  return new Set(records.map((r) => r.question_id));
}

/**
 * Verify that the config and prompt hashes match the existing manifest.
 * Rejects resume if commit, prompt, or config differ.
 */
export function verifyResumeConfig(manifest, config, answerPrompt) {
  const expectedConfigHash = configHash(config);
  const expectedPromptHash = sha256(answerPrompt);
  if (manifest.config_hash !== expectedConfigHash) {
    throw new Error(
      `Config mismatch: manifest has ${manifest.config_hash} but current config is ${expectedConfigHash}. ` +
      'Resume requires the same config. Start a new run instead.'
    );
  }
  if (manifest.prompt_hash !== expectedPromptHash) {
    throw new Error(
      `Prompt mismatch: manifest has ${manifest.prompt_hash} but current prompt is ${expectedPromptHash}. ` +
      'Resume requires the same answer prompt.'
    );
  }
}

/** Find a run directory by run-id under runsRoot. */
export async function findRunDir(runsRoot, runId) {
  const runDir = path.join(runsRoot, runId);
  try {
    await readFile(path.join(runDir, 'manifest.json'), 'utf8');
    return runDir;
  } catch {
    throw new Error(`Run directory not found: ${runDir}. Available runs can be listed under ${runsRoot}.`);
  }
}

/** Update manifest fields (e.g., status, completed_at). */
export async function updateManifest(runDir, updates) {
  const manifestPath = path.join(runDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const updated = { ...manifest, ...updates };
  await writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}
