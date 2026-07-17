#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeLongMemEvalGeneration, toLongMemEvalOfficialOutput } from '../adapters/longmemeval.mjs';
import { normalizeLocomoGeneration, toLocomoOfficialOutput } from '../adapters/locomo.mjs';
import { PRODUCT_COMMIT, assertGoldFree, assertResultsLocked, loadAuthorization, lockResults, readGenerationProjection, sha256File } from '../lib/sealed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..');

function flag(name, fallback) {
  const assigned = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  if (assigned) return assigned.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function exists(file) { try { await access(file); return true; } catch { return false; } }

export function adapterFor(benchmark) {
  if (benchmark === 'longmemeval') return {
    fixture: path.join(ROOT, 'fixtures', 'longmemeval-generation-12.json'),
    flatten: (records) => records.map(normalizeLongMemEvalGeneration),
    output: toLongMemEvalOfficialOutput,
  };
  if (benchmark === 'locomo') return {
    fixture: path.join(ROOT, 'fixtures', 'locomo-generation-fictional.json'),
    flatten: (records) => records.flatMap(normalizeLocomoGeneration),
    output: toLocomoOfficialOutput,
  };
  throw new Error(`UNSUPPORTED_BENCHMARK:${benchmark}`);
}

function fixtureAnswer(record) {
  const text = record.sessions.flatMap((session) => session.messages || session.turns || []).map((entry) => entry.content || entry.text).join(' ');
  return text ? `[FIXTURE ADAPTER OUTPUT] ${text.slice(0, 96)}` : null;
}

export async function runFixture({ benchmark, outputRoot, interruptAfter = Infinity }) {
  const adapter = adapterFor(benchmark);
  await mkdir(outputRoot, { recursive: true });
  const checkpointPath = path.join(outputRoot, 'checkpoint.json');
  const resultPath = path.join(outputRoot, 'results.jsonl');
  const raw = await readJson(adapter.fixture);
  assertGoldFree(raw);
  const records = adapter.flatten(raw);
  let completedIds = new Set();
  if (await exists(checkpointPath)) completedIds = new Set((await readJson(checkpointPath)).completed_ids);
  let output = await readFile(resultPath, 'utf8').catch(() => '');
  let processed = 0;
  for (const record of records) {
    if (completedIds.has(record.id)) continue;
    const started = Date.now();
    const row = adapter.output(record, fixtureAnswer(record), { fixture: true, latency_ms: Date.now() - started, dynamic_port: true, isolated_database: true, service_identity_attested: true });
    output += `${JSON.stringify(row)}\n`;
    await writeFile(resultPath, output, 'utf8');
    completedIds.add(record.id);
    await writeFile(checkpointPath, `${JSON.stringify({ schema_version: 1, benchmark, completed_ids: [...completedIds] }, null, 2)}\n`, 'utf8');
    processed++;
    if (processed >= interruptAfter) return { status: 'interrupted', completed: completedIds.size, expected: records.length, resultPath };
  }
  const lock = await lockResults(resultPath, path.join(outputRoot, 'results.lock.json')).catch(async (error) => {
    if (error.code !== 'EEXIST') throw error;
    return assertResultsLocked(resultPath, path.join(outputRoot, 'results.lock.json'));
  });
  return { status: 'completed', completed: completedIds.size, expected: records.length, resultPath, lock };
}

export async function validateFormalRequest(options) {
  const preregHash = await sha256File(options.preregistrationPath);
  const generationHash = await sha256File(options.generationDataPath);
  const auth = await loadAuthorization(options.authorizationFile, {
    benchmark: options.benchmark,
    dataset_variant: options.datasetVariant,
    allowed_subset: options.allowedSubset,
    dataset_sha256: generationHash,
    product_commit: PRODUCT_COMMIT,
    adapter_commit: options.adapterCommit,
    preregistration_sha256: preregHash,
  });
  return { auth, preregHash, generationHash };
}

export async function runFormalGeneration(options) {
  const validated = await validateFormalRequest(options);
  const { records } = await readGenerationProjection(options.generationDataPath, {
    expected_sha256: validated.generationHash,
    log_path: options.accessLog,
    allowed_subset: options.allowedSubset,
    reader_commit: options.adapterCommit,
  });
  if (!options.engineModule) throw new Error('FORMAL_ENGINE_MODULE_REQUIRED');
  const engineModule = await import(pathToFileURL(path.resolve(options.engineModule)));
  if (typeof engineModule.createEngine !== 'function') throw new Error('FORMAL_ENGINE_INTERFACE_INVALID');
  const adapter = adapterFor(options.benchmark);
  const normalized = adapter.flatten(records);
  await mkdir(options.outputRoot, { recursive: true });
  const resultPath = path.join(options.outputRoot, 'results.jsonl');
  const checkpointPath = path.join(options.outputRoot, 'checkpoint.json');
  const completed = new Set((await readJson(checkpointPath).catch(() => ({ completed_ids: [] }))).completed_ids);
  let output = await readFile(resultPath, 'utf8').catch(() => '');
  for (const record of normalized) {
    if (completed.has(record.id)) continue;
    const engine = await engineModule.createEngine({ productCommit: PRODUCT_COMMIT, isolatedDatabase: true, dynamicPort: true });
    try {
      for (const session of record.sessions) await engine.ingest(session);
      const started = Date.now();
      const response = await engine.query({ question: record.question, questionDate: record.question_date || null });
      output += `${JSON.stringify(adapter.output(record, response.answer ?? null, { ...response.diagnostics, latency_ms: Date.now() - started }))}\n`;
      await writeFile(resultPath, output, 'utf8');
      completed.add(record.id);
      await writeFile(checkpointPath, `${JSON.stringify({ schema_version: 1, completed_ids: [...completed] }, null, 2)}\n`, 'utf8');
    } finally { await engine.stop?.(); }
  }
  return lockResults(resultPath, path.join(options.outputRoot, 'results.lock.json'));
}

export async function runScoreOnly({ resultPath, lockPath, goldPath, scoreOutputPath, scorer }) {
  const before = await assertResultsLocked(resultPath, lockPath);
  const gold = JSON.parse(await readFile(goldPath, 'utf8'));
  const results = (await readFile(resultPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const metrics = await scorer(results, gold);
  await writeFile(scoreOutputPath, `${JSON.stringify({ schema_version: 1, result_sha256: before.result_sha256, metrics }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await assertResultsLocked(resultPath, lockPath);
  return metrics;
}

async function validateOnly() {
  const paths = [
    path.join(ROOT, 'preregistration', 'longmemeval-v1.json'),
    path.join(ROOT, 'preregistration', 'locomo-heldout-v1.json'),
  ];
  const preregistrations = await Promise.all(paths.map(readJson));
  for (const prereg of preregistrations) {
    if (prereg.product_commit !== PRODUCT_COMMIT || prereg.formal_status !== 'NOT AUTHORIZED / NOT RUN') throw new Error('PREREGISTRATION_LOCK_INVALID');
  }
  for (const benchmark of ['longmemeval', 'locomo']) assertGoldFree(await readJson(adapterFor(benchmark).fixture));
  return { schema_version: 1, status: 'VALID', formal_run: false, heldout_accessed: false, preregistrations: paths.map((file, index) => ({ file: path.relative(REPO, file).replaceAll('\\', '/'), benchmark: preregistrations[index].benchmark })) };
}

async function main() {
  if (process.argv.includes('--validate-only')) return console.log(JSON.stringify(await validateOnly()));
  const benchmark = flag('--benchmark');
  const outputRoot = path.resolve(flag('--output-root', path.join(ROOT, 'runs', `${benchmark}-fixture`)));
  if (process.argv.includes('--fixture')) return console.log(JSON.stringify(await runFixture({ benchmark, outputRoot })));
  if (process.argv.includes('--formal')) {
    const authorizationFile = process.env.OMNI_HELDOUT_AUTHORIZATION_FILE;
    if (!authorizationFile) throw new Error('HELDOUT_AUTHORIZATION_REQUIRED:OMNI_HELDOUT_AUTHORIZATION_FILE');
    const adapterCommit = flag('--adapter-commit');
    const preregistrationPath = path.resolve(flag('--preregistration'));
    const generationDataPath = path.resolve(flag('--generation-data'));
    const options = { authorizationFile, adapterCommit, preregistrationPath, generationDataPath, benchmark, datasetVariant: flag('--dataset-variant'), allowedSubset: flag('--allowed-subset'), accessLog: path.join(outputRoot, 'data-access.jsonl'), outputRoot, engineModule: flag('--engine-module') };
    return console.log(JSON.stringify(await runFormalGeneration(options)));
  }
  if (process.argv.includes('--score-only')) throw new Error('SCORE_ONLY_REQUIRES_IMPORTED_OFFICIAL_SCORER_MODULE');
  throw new Error('MODE_REQUIRED:--fixture|--validate-only|--formal|--score-only');
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(JSON.stringify({ status: 'REFUSED', error: error.message })); process.exitCode = 1; });
