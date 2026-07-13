import { randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configHash, sha256 } from './integrity.mjs';
import { conversationDirectory } from './conversation-runtime.mjs';

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
  conversationIds = [1],
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
    conversation_ids: conversationIds.map(Number),
    dataset,
    benchmark_commit: benchmarkCommit,
    brain_server_commit: brainServerCommit,
    config_hash: configHash(config),
    prompt_hash: sha256(prompt),
    embedding_status: embeddingStatus,
    status: 'running',
  };
  await writeFile(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  for (const conversationId of manifest.conversation_ids) {
    await initializeConversationRun(runDir, conversationId);
  }
  return { runDir, manifest };
}

export async function initializeConversationRun(runDir, conversationId) {
  const conversationDir = conversationDirectory(runDir, conversationId);
  await mkdir(conversationDir, { recursive: false });
  await writeFile(path.join(conversationDir, 'results.jsonl'), '', { flag: 'wx' });
  await writeFile(path.join(conversationDir, 'ingestion.json'), `${JSON.stringify({
    schema_version: 1,
    conversation_id: Number(conversationId),
    status: 'pending',
    sessions_completed: [],
  }, null, 2)}\n`, { flag: 'wx' });
  return conversationDir;
}

export async function readRun(runDir) {
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  const records = [];
  const resultFiles = await resultFilesForRun(runDir, manifest);
  for (const resultFile of resultFiles) {
    const raw = await readFile(resultFile, 'utf8');
    const fileRecords = raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { throw new Error(`Invalid JSONL at ${resultFile}:${index + 1}: ${error.message}`); }
    });
    records.push(...fileRecords);
  }
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
  const manifest = JSON.parse(await readFile(path.join(runDir, 'manifest.json'), 'utf8'));
  const conversationId = Number(record.conversation_id ?? singleConversationId(manifest));
  if (!manifest.conversation_ids.map(Number).includes(conversationId)) {
    throw new Error(`Conversation ${conversationId} is not part of run ${manifest.run_id}.`);
  }
  const line = `${JSON.stringify({ recorded_at: new Date().toISOString(), ...record, conversation_id: conversationId })}\n`;
  const handle = await open(path.join(conversationDirectory(runDir, conversationId), 'results.jsonl'), 'a');
  try {
    await handle.write(line);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function resultFilesForRun(runDir, manifest) {
  const files = [];
  for (const conversationId of manifest.conversation_ids || []) {
    const resultFile = path.join(conversationDirectory(runDir, conversationId), 'results.jsonl');
    if (await exists(resultFile)) files.push(resultFile);
  }
  // Read-only compatibility for runs created before the v3.1 per-conversation layout.
  const legacy = path.join(runDir, 'results.jsonl');
  if (files.length === 0 && await exists(legacy)) files.push(legacy);
  return files;
}

function singleConversationId(manifest) {
  if (manifest.conversation_ids?.length === 1) return manifest.conversation_ids[0];
  throw new Error('conversation_id is required when a run contains multiple conversations.');
}

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
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
