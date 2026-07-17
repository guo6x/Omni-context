import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRODUCT_COMMIT } from '../lib/sealed.mjs';
import { runFormalGeneration } from '../runners/sealed-runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_ROOT = 'D:\\OmniContext-research-runs\\external\\test-temp';
const ADAPTER_COMMIT = '1234567890abcdef1234567890abcdef12345678';
const MOCK_ENGINE_PATH = path.join(ROOT, 'tests', 'mock-engine.mjs');

async function tempDir(t) {
  await mkdir(TEMP_ROOT, { recursive: true });
  const dir = await mkdtemp(path.join(TEMP_ROOT, 'retry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

function validAuth(overrides = {}) {
  return {
    schema_version: 1,
    authorized_by: 'test-custodian',
    authorized_at: new Date(Date.now() - 60000).toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    benchmark: 'longmemeval',
    dataset_variant: 'test',
    allowed_subset: 'test-only',
    dataset_sha256: 'a'.repeat(64),
    product_commit: PRODUCT_COMMIT,
    adapter_commit: ADAPTER_COMMIT,
    preregistration_sha256: 'b'.repeat(64),
    allow_formal_run: true,
    ...overrides,
  };
}

function makeRecord(id) {
  return {
    question_id: id,
    question_type: 'single-session-user',
    question: `Question for ${id}`,
    question_date: '2026-01-12',
    haystack_session_ids: ['s1'],
    haystack_dates: ['2026-01-01T09:00:00Z'],
    haystack_sessions: [[{ role: 'user', content: 'Hello.' }]],
  };
}

async function setupFormalRun(t, dir, records, behavior) {
  const dataJson = JSON.stringify(records);
  const preregJson = '{"schema_version":3}\n';
  const dataHash = digest(dataJson);
  const preregHash = digest(preregJson);
  const auth = validAuth({ dataset_sha256: dataHash, preregistration_sha256: preregHash });
  const dataPath = path.join(dir, 'generation.json');
  const preregPath = path.join(dir, 'prereg.json');
  const authPath = path.join(dir, 'auth.json');
  const behaviorPath = path.join(dir, 'behavior.json');
  const outputRoot = path.join(dir, 'output');
  await writeFile(dataPath, dataJson);
  await writeFile(preregPath, preregJson);
  await writeFile(authPath, JSON.stringify(auth));
  await writeFile(behaviorPath, JSON.stringify(behavior));
  const origEnv = { ...process.env };
  process.env.OMNI_HELDOUT_AUTHORIZATION_FILE = authPath;
  process.env.MOCK_ENGINE_BEHAVIOR_PATH = behaviorPath;
  t.after(() => { process.env = { ...origEnv }; });
  return { dataPath, preregPath, authPath, outputRoot, engineModule: MOCK_ENGINE_PATH };
}

async function readResults(outputRoot) {
  const content = await readFile(path.join(outputRoot, 'results.jsonl'), 'utf8');
  return content.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

async function readCheckpoint(outputRoot) {
  return JSON.parse(await readFile(path.join(outputRoot, 'checkpoint.json'), 'utf8'));
}

async function readAttemptLog(outputRoot) {
  const content = await readFile(path.join(outputRoot, 'attempt-log.jsonl'), 'utf8');
  return content.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

test('formal runner: 429 error triggers retry and succeeds on second attempt', async (t) => {
  const dir = await tempDir(t);
  const records = [makeRecord('q1')];
  const behavior = { 'Question for q1': [{ error: 'MOONSHOT_API_ERROR:429:rate limited' }, { answer: 'success-after-retry' }] };
  const setup = await setupFormalRun(t, dir, records, behavior);
  await runFormalGeneration({
    authorizationFile: setup.authPath, adapterCommit: ADAPTER_COMMIT, preregistrationPath: setup.preregPath,
    generationDataPath: setup.dataPath, benchmark: 'longmemeval', datasetVariant: 'test', allowedSubset: 'test-only',
    accessLog: path.join(setup.outputRoot, 'data-access.jsonl'), outputRoot: setup.outputRoot, engineModule: setup.engineModule,
  });
  const results = await readResults(setup.outputRoot);
  assert.equal(results.length, 1);
  assert.equal(results[0].question_id, 'q1');
  assert.equal(results[0].hypothesis, 'success-after-retry');
  const checkpoint = await readCheckpoint(setup.outputRoot);
  assert.ok(checkpoint.completed_ids.includes('q1'));
  assert.equal(checkpoint.terminal_error_ids.length, 0);
  const attempts = await readAttemptLog(setup.outputRoot);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].status, 'error');
  assert.equal(attempts[0].error_type, '429');
  assert.equal(attempts[1].status, 'ok');
});

test('formal runner: 5xx error triggers retry and succeeds on second attempt', async (t) => {
  const dir = await tempDir(t);
  const records = [makeRecord('q1')];
  const behavior = { 'Question for q1': [{ error: 'MOONSHOT_API_ERROR:500:server error' }, { answer: 'success-after-retry' }] };
  const setup = await setupFormalRun(t, dir, records, behavior);
  await runFormalGeneration({
    authorizationFile: setup.authPath, adapterCommit: ADAPTER_COMMIT, preregistrationPath: setup.preregPath,
    generationDataPath: setup.dataPath, benchmark: 'longmemeval', datasetVariant: 'test', allowedSubset: 'test-only',
    accessLog: path.join(setup.outputRoot, 'data-access.jsonl'), outputRoot: setup.outputRoot, engineModule: setup.engineModule,
  });
  const results = await readResults(setup.outputRoot);
  assert.equal(results[0].hypothesis, 'success-after-retry');
  const attempts = await readAttemptLog(setup.outputRoot);
  assert.equal(attempts[0].error_type, '5xx');
  assert.equal(attempts[1].status, 'ok');
});

test('formal runner: non-retryable error results in terminal error', async (t) => {
  const dir = await tempDir(t);
  const records = [makeRecord('q1')];
  const behavior = { 'Question for q1': [{ error: 'UNKNOWN_FATAL_ERROR:something went wrong' }] };
  const setup = await setupFormalRun(t, dir, records, behavior);
  await runFormalGeneration({
    authorizationFile: setup.authPath, adapterCommit: ADAPTER_COMMIT, preregistrationPath: setup.preregPath,
    generationDataPath: setup.dataPath, benchmark: 'longmemeval', datasetVariant: 'test', allowedSubset: 'test-only',
    accessLog: path.join(setup.outputRoot, 'data-access.jsonl'), outputRoot: setup.outputRoot, engineModule: setup.engineModule,
  });
  const results = await readResults(setup.outputRoot);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'error');
  assert.equal(results[0].hypothesis, null);
  assert.equal(results[0].error_type, 'unknown');
  assert.equal(results[0].attempts, 1);
  const checkpoint = await readCheckpoint(setup.outputRoot);
  assert.ok(checkpoint.terminal_error_ids.includes('q1'));
  assert.equal(checkpoint.completed_ids.length, 0);
  const attempts = await readAttemptLog(setup.outputRoot);
  assert.equal(attempts.length, 1);
});

test('formal runner: three failures result in terminal error with attempts=3', async (t) => {
  const dir = await tempDir(t);
  const records = [makeRecord('q1')];
  const behavior = { 'Question for q1': [
    { error: 'MOONSHOT_API_ERROR:429:rate limited' },
    { error: 'MOONSHOT_API_ERROR:429:rate limited' },
    { error: 'MOONSHOT_API_ERROR:429:rate limited' },
  ] };
  const setup = await setupFormalRun(t, dir, records, behavior);
  await runFormalGeneration({
    authorizationFile: setup.authPath, adapterCommit: ADAPTER_COMMIT, preregistrationPath: setup.preregPath,
    generationDataPath: setup.dataPath, benchmark: 'longmemeval', datasetVariant: 'test', allowedSubset: 'test-only',
    accessLog: path.join(setup.outputRoot, 'data-access.jsonl'), outputRoot: setup.outputRoot, engineModule: setup.engineModule,
  });
  const results = await readResults(setup.outputRoot);
  assert.equal(results[0].status, 'error');
  assert.equal(results[0].attempts, 3);
  const checkpoint = await readCheckpoint(setup.outputRoot);
  assert.ok(checkpoint.terminal_error_ids.includes('q1'));
  const attempts = await readAttemptLog(setup.outputRoot);
  assert.equal(attempts.length, 3);
  for (const a of attempts) { assert.equal(a.status, 'error'); assert.equal(a.error_type, '429'); }
});

test('formal runner: completed question is not re-run on restart', async (t) => {
  const dir = await tempDir(t);
  const records = [makeRecord('q1'), makeRecord('q2')];
  const behavior = { 'Question for q1': [{ answer: 'answer-q1' }], 'Question for q2': [{ answer: 'answer-q2' }] };
  const setup = await setupFormalRun(t, dir, records, behavior);
  await mkdir(setup.outputRoot, { recursive: true });
  await writeFile(path.join(setup.outputRoot, 'checkpoint.json'), JSON.stringify({ schema_version: 2, benchmark: 'longmemeval', completed_ids: ['q1'], terminal_error_ids: [] }, null, 2) + '\n');
  await writeFile(path.join(setup.outputRoot, 'results.jsonl'), JSON.stringify({ question_id: 'q1', hypothesis: 'previous-answer', abstained: false, diagnostics: {} }) + '\n');
  await runFormalGeneration({
    authorizationFile: setup.authPath, adapterCommit: ADAPTER_COMMIT, preregistrationPath: setup.preregPath,
    generationDataPath: setup.dataPath, benchmark: 'longmemeval', datasetVariant: 'test', allowedSubset: 'test-only',
    accessLog: path.join(setup.outputRoot, 'data-access.jsonl'), outputRoot: setup.outputRoot, engineModule: setup.engineModule,
  });
  const results = await readResults(setup.outputRoot);
  assert.equal(results.length, 2);
  const q1Result = results.find((r) => r.question_id === 'q1');
  assert.equal(q1Result.hypothesis, 'previous-answer');
  const q2Result = results.find((r) => r.question_id === 'q2');
  assert.equal(q2Result.hypothesis, 'answer-q2');
});

test('formal runner: terminal error question is not re-run on restart', async (t) => {
  const dir = await tempDir(t);
  const records = [makeRecord('q1'), makeRecord('q2')];
  const behavior = { 'Question for q1': [{ answer: 'answer-q1' }], 'Question for q2': [{ answer: 'answer-q2' }] };
  const setup = await setupFormalRun(t, dir, records, behavior);
  await mkdir(setup.outputRoot, { recursive: true });
  await writeFile(path.join(setup.outputRoot, 'checkpoint.json'), JSON.stringify({ schema_version: 2, benchmark: 'longmemeval', completed_ids: [], terminal_error_ids: ['q1'] }, null, 2) + '\n');
  await writeFile(path.join(setup.outputRoot, 'results.jsonl'), JSON.stringify({ question_id: 'q1', status: 'error', hypothesis: null, error_type: '429', attempts: 3 }) + '\n');
  await runFormalGeneration({
    authorizationFile: setup.authPath, adapterCommit: ADAPTER_COMMIT, preregistrationPath: setup.preregPath,
    generationDataPath: setup.dataPath, benchmark: 'longmemeval', datasetVariant: 'test', allowedSubset: 'test-only',
    accessLog: path.join(setup.outputRoot, 'data-access.jsonl'), outputRoot: setup.outputRoot, engineModule: setup.engineModule,
  });
  const results = await readResults(setup.outputRoot);
  assert.equal(results.length, 2);
  const q1Result = results.find((r) => r.question_id === 'q1');
  assert.equal(q1Result.status, 'error');
  const q2Result = results.find((r) => r.question_id === 'q2');
  assert.equal(q2Result.hypothesis, 'answer-q2');
});

test('formal runner: attempt log is sanitized', async (t) => {
  const dir = await tempDir(t);
  const records = [makeRecord('q1')];
  const behavior = { 'Question for q1': [{ answer: 'success-answer' }] };
  const setup = await setupFormalRun(t, dir, records, behavior);
  await runFormalGeneration({
    authorizationFile: setup.authPath, adapterCommit: ADAPTER_COMMIT, preregistrationPath: setup.preregPath,
    generationDataPath: setup.dataPath, benchmark: 'longmemeval', datasetVariant: 'test', allowedSubset: 'test-only',
    accessLog: path.join(setup.outputRoot, 'data-access.jsonl'), outputRoot: setup.outputRoot, engineModule: setup.engineModule,
  });
  const attempts = await readAttemptLog(setup.outputRoot);
  for (const entry of attempts) {
    const keys = Object.keys(entry);
    assert.deepEqual(keys.sort(), ['attempt', 'completed_at', 'error_type', 'question_id', 'started_at', 'status'].sort());
    assert.equal(entry.question, undefined);
    assert.equal(entry.answer, undefined);
    assert.equal(entry.hypothesis, undefined);
    assert.equal(entry.gold, undefined);
  }
});

test('formal runner: mix of success and terminal error', async (t) => {
  const dir = await tempDir(t);
  const records = [makeRecord('q1'), makeRecord('q2'), makeRecord('q3')];
  const behavior = {
    'Question for q1': [{ answer: 'answer-q1' }],
    'Question for q2': [{ error: 'MOONSHOT_API_ERROR:429:rate limited' }, { error: 'MOONSHOT_API_ERROR:429:rate limited' }, { error: 'MOONSHOT_API_ERROR:429:rate limited' }],
    'Question for q3': [{ answer: 'answer-q3' }],
  };
  const setup = await setupFormalRun(t, dir, records, behavior);
  await runFormalGeneration({
    authorizationFile: setup.authPath, adapterCommit: ADAPTER_COMMIT, preregistrationPath: setup.preregPath,
    generationDataPath: setup.dataPath, benchmark: 'longmemeval', datasetVariant: 'test', allowedSubset: 'test-only',
    accessLog: path.join(setup.outputRoot, 'data-access.jsonl'), outputRoot: setup.outputRoot, engineModule: setup.engineModule,
  });
  const checkpoint = await readCheckpoint(setup.outputRoot);
  assert.equal(checkpoint.completed_ids.length, 2);
  assert.equal(checkpoint.terminal_error_ids.length, 1);
  assert.ok(checkpoint.completed_ids.includes('q1'));
  assert.ok(checkpoint.terminal_error_ids.includes('q2'));
  assert.ok(checkpoint.completed_ids.includes('q3'));
});
