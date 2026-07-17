import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeLongMemEvalGeneration } from '../adapters/longmemeval.mjs';
import { normalizeLocomoGeneration } from '../adapters/locomo.mjs';
import { PRODUCT_COMMIT, assertGoldFree, assertResultsLocked, lockResults, sha256File, validateAuthorization } from '../lib/sealed.mjs';
import { runFixture, runScoreOnly, validateFormalRequest } from '../runners/sealed-runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_ROOT = 'D:\\OmniContext-research-runs\\external\\test-temp';
const ADAPTER_COMMIT = '1234567890abcdef1234567890abcdef12345678';

async function tempDir(t) {
  await mkdir(TEMP_ROOT, { recursive: true });
  const dir = await mkdtemp(path.join(TEMP_ROOT, 'sealed-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function validAuth(overrides = {}) {
  return {
    schema_version: 1,
    authorized_by: 'fixture-custodian',
    authorized_at: new Date(Date.now() - 60000).toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    benchmark: 'longmemeval',
    dataset_variant: 'fixture',
    allowed_subset: 'fixture-only',
    dataset_sha256: 'a'.repeat(64),
    product_commit: PRODUCT_COMMIT,
    adapter_commit: ADAPTER_COMMIT,
    preregistration_sha256: 'b'.repeat(64),
    allow_formal_run: true,
    ...overrides,
  };
}

test('LongMemEval has twelve fictional, Gold-free fixture records with official order preserved', async () => {
  const records = JSON.parse(await readFile(path.join(ROOT, 'fixtures', 'longmemeval-generation-12.json'), 'utf8'));
  assert.equal(records.length, 12);
  assert.doesNotThrow(() => assertGoldFree(records));
  const normalized = normalizeLongMemEvalGeneration(records[3]);
  assert.deepEqual(normalized.sessions.map((item) => item.session_id), ['s2', 's1']);
});

test('LoCoMo fictional fixture supports four QA forms without annotation fields', async () => {
  const records = JSON.parse(await readFile(path.join(ROOT, 'fixtures', 'locomo-generation-fictional.json'), 'utf8'));
  assert.doesNotThrow(() => assertGoldFree(records));
  const questions = normalizeLocomoGeneration(records[0]);
  assert.deepEqual(questions.map((item) => item.category), ['single-session', 'temporal', 'causal', 'multi-session']);
});

test('formal authorization is required and expired authorization is rejected', () => {
  assert.throws(() => validateAuthorization(undefined, {}), /AUTHORIZATION_INVALID/);
  assert.throws(() => validateAuthorization(validAuth({ expires_at: new Date(Date.now() - 1).toISOString() }), {}), /AUTHORIZATION_EXPIRED/);
});

test('formal CLI refuses before resolving data when authorization environment is absent', () => {
  const env = { ...process.env };
  delete env.OMNI_HELDOUT_AUTHORIZATION_FILE;
  const run = spawnSync(process.execPath, [path.join(ROOT, 'runners', 'sealed-runner.mjs'), '--formal', '--benchmark=longmemeval'], { env, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /HELDOUT_AUTHORIZATION_REQUIRED:OMNI_HELDOUT_AUTHORIZATION_FILE/);
});

test('score-only CLI refuses before resolving Gold when authorization environment is absent', () => {
  const env = { ...process.env };
  delete env.OMNI_HELDOUT_AUTHORIZATION_FILE;
  const run = spawnSync(process.execPath, [path.join(ROOT, 'runners', 'sealed-runner.mjs'), '--score-only', '--benchmark=longmemeval'], { env, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /HELDOUT_AUTHORIZATION_REQUIRED:OMNI_HELDOUT_AUTHORIZATION_FILE/);
});

test('authorization rejects data hash, product, adapter, preregistration, and subset mismatch', () => {
  const cases = [
    ['dataset_sha256', validAuth(), { dataset_sha256: 'c'.repeat(64) }],
    ['product_commit', validAuth({ product_commit: 'f'.repeat(40) }), { product_commit: PRODUCT_COMMIT }],
    ['adapter_commit', validAuth({ adapter_commit: 'e'.repeat(40) }), { adapter_commit: ADAPTER_COMMIT }],
    ['preregistration_sha256', validAuth(), { preregistration_sha256: 'd'.repeat(64) }],
    ['allowed_subset', validAuth(), { allowed_subset: 'sealed-heldout' }],
  ];
  for (const [key, auth, expected] of cases) assert.throws(() => validateAuthorization(auth, expected), new RegExp(`AUTHORIZATION_MISMATCH:${key}`));
});

test('validateFormalRequest binds authorization to exact files and commits', async (t) => {
  const dir = await tempDir(t);
  const data = '[{"question_id":"q","question":"q?","haystack_sessions":[]}]\n';
  const prereg = '{"schema_version":1}\n';
  const dataPath = path.join(dir, 'generation.json');
  const preregPath = path.join(dir, 'prereg.json');
  const authPath = path.join(dir, 'auth.json');
  await writeFile(dataPath, data); await writeFile(preregPath, prereg);
  await writeFile(authPath, JSON.stringify(validAuth({ dataset_sha256: digest(data), preregistration_sha256: digest(prereg) })));
  const result = await validateFormalRequest({ authorizationFile: authPath, benchmark: 'longmemeval', datasetVariant: 'fixture', allowedSubset: 'fixture-only', generationDataPath: dataPath, preregistrationPath: preregPath, adapterCommit: ADAPTER_COMMIT });
  assert.equal(result.generationHash, digest(data));
});

test('Gold fields are structurally inaccessible in generation phase', () => {
  assert.throws(() => assertGoldFree({ history: [], question: 'q', answer: 'secret' }), /GOLD_ISOLATION_VIOLATION/);
  assert.throws(() => assertGoldFree({ records: [{ nested: { evidence: ['d1'] } }] }), /GOLD_ISOLATION_VIOLATION/);
});

test('result hash lock detects mutation', async (t) => {
  const dir = await tempDir(t);
  const results = path.join(dir, 'results.jsonl');
  const lock = path.join(dir, 'results.lock.json');
  await writeFile(results, '{"id":"q1"}\n');
  await lockResults(results, lock);
  await assertResultsLocked(results, lock);
  await writeFile(results, '{"id":"q1","changed":true}\n');
  await assert.rejects(() => assertResultsLocked(results, lock), /RESULT_HASH_MISMATCH/);
});

test('score-only writes separate metrics and cannot modify locked results', async (t) => {
  const dir = await tempDir(t);
  const resultPath = path.join(dir, 'results.jsonl');
  const lockPath = path.join(dir, 'results.lock.json');
  const goldPath = path.join(dir, 'gold.json');
  const metricsPath = path.join(dir, 'metrics.json');
  const accessLog = path.join(dir, 'data-access.jsonl');
  await writeFile(resultPath, '{"question_id":"q1","hypothesis":"x"}\n');
  await writeFile(goldPath, '{"q1":"x"}\n');
  await lockResults(resultPath, lockPath);
  const before = await sha256File(resultPath);
  await runScoreOnly({ resultPath, lockPath, goldPath, scoreOutputPath: metricsPath, scorer: (rows, gold) => ({ exact: rows[0].hypothesis === gold.q1 ? 1 : 0 }), accessLog, allowedSubset: 'fixture-only', adapterCommit: ADAPTER_COMMIT });
  assert.equal(await sha256File(resultPath), before);
  assert.equal((await readFile(metricsPath, 'utf8')).includes('"exact": 1'), true);
  assert.match(await readFile(accessLog, 'utf8'), /"phase":"scoring".*"accessed_gold":true/);
});

test('fixture checkpoint resumes without duplicate rows', async (t) => {
  const dir = await tempDir(t);
  const first = await runFixture({ benchmark: 'longmemeval', outputRoot: dir, interruptAfter: 3 });
  assert.equal(first.completed, 3);
  const resumed = await runFixture({ benchmark: 'longmemeval', outputRoot: dir });
  assert.equal(resumed.completed, 12);
  const rows = (await readFile(resumed.resultPath, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(new Set(rows.map((row) => row.question_id)).size, 12);
});

test('external-eval tracked text contains no API key or Authorization header', async () => {
  async function filesBelow(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesBelow(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))).flat();
  }
  const files = (await filesBelow(ROOT)).filter((file) => /\.(?:mjs|json|md)$/.test(file));
  const text = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  assert.equal(/\bsk-[A-Za-z0-9_-]{20,}\b|Authorization\s*:\s*Bearer/i.test(text), false);
});
