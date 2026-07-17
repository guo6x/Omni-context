#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeLongMemEvalGeneration, toLongMemEvalOfficialOutput, QUESTION_ENVELOPE_VERSION, QUESTION_ENVELOPE_SHA256 } from '../adapters/longmemeval.mjs';
import { normalizeLocomoGeneration, toLocomoOfficialOutput } from '../adapters/locomo.mjs';
import { PRODUCT_COMMIT, appendAccessLog, assertGoldFree, assertResultsLocked, loadAuthorization, lockResults, readGenerationProjection, sha256File } from '../lib/sealed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..');

const FORMAL_RETRYABLE_ERRORS = new Set(['schema_validation', '429', '5xx', 'network', 'timeout']);
const FORMAL_MAX_RETRIES = 2;

function flag(name, fallback) {
  const assigned = process.argv.slice(2).find((value) => value.startsWith(`${name}=`));
  if (assigned) return assigned.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function requiredFlag(name) {
  const value = flag(name);
  if (!value) throw new Error(`REQUIRED_ARGUMENT_MISSING:${name}`);
  return value;
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

function classifyFormalError(error) {
  const msg = String(error?.message || error || '');
  if (/429|rate.?limit/i.test(msg)) return '429';
  if (/5\d{2}|server.?error|internal.?error/i.test(msg)) return '5xx';
  if (/timeout|timed.?out/i.test(msg)) return 'timeout';
  if (/network|econnreset|enotfound|eai_again|econnrefused|socket/i.test(msg)) return 'network';
  if (/schema.?validation|invalid.?json|parse/i.test(msg)) return 'schema_validation';
  return 'unknown';
}

async function loadCheckpoint(checkpointPath) {
  if (await exists(checkpointPath)) {
    const data = await readJson(checkpointPath);
    return {
      completed_ids: new Set(data.completed_ids || []),
      terminal_error_ids: new Set(data.terminal_error_ids || []),
    };
  }
  return { completed_ids: new Set(), terminal_error_ids: new Set() };
}

async function saveCheckpoint(checkpointPath, benchmark, completedIds, terminalErrorIds) {
  const data = {
    schema_version: 2,
    benchmark,
    completed_ids: [...completedIds].sort(),
    terminal_error_ids: [...terminalErrorIds].sort(),
  };
  await writeFile(checkpointPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

async function appendAttemptLog(attemptLogPath, entry) {
  await mkdir(path.dirname(attemptLogPath), { recursive: true });
  const sanitized = {
    question_id: entry.question_id,
    attempt: entry.attempt,
    status: entry.status,
    error_type: entry.error_type || null,
    started_at: entry.started_at,
    completed_at: entry.completed_at,
  };
  await writeFile(attemptLogPath, `${JSON.stringify(sanitized)}\n`, { encoding: 'utf8', flag: 'a' });
}

async function appendResult(resultPath, row) {
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(row)}\n`, { encoding: 'utf8', flag: 'a' });
}

async function attemptQuestion(engineModule, adapter, record, attempt) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const engine = await engineModule.createEngine({ productCommit: PRODUCT_COMMIT, isolatedDatabase: true, dynamicPort: true });
  try {
    for (const session of record.sessions) await engine.ingest(session);
    const response = await engine.query({ question: record.question, questionDate: record.question_date || null });
    const completedAt = new Date().toISOString();
    return {
      status: 'ok',
      error_type: null,
      started_at: startedAt,
      completed_at: completedAt,
      latency_ms: Date.now() - startedMs,
      answer: response.answer ?? null,
      diagnostics: response.diagnostics || {},
    };
  } finally {
    await engine.stop?.().catch(() => {});
  }
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
  const attemptLogPath = path.join(options.outputRoot, 'attempt-log.jsonl');

  const checkpoint = await loadCheckpoint(checkpointPath);
  const completedIds = checkpoint.completed_ids;
  const terminalErrorIds = checkpoint.terminal_error_ids;

  for (const record of normalized) {
    if (completedIds.has(record.id)) continue;
    if (terminalErrorIds.has(record.id)) continue;

    let lastErrorType = 'unknown';
    let success = false;
    let successResult = null;
    let actualAttempts = 0;

    for (let attempt = 0; attempt <= FORMAL_MAX_RETRIES; attempt++) {
      actualAttempts = attempt + 1;
      const attemptStartedAt = new Date().toISOString();
      try {
        const result = await attemptQuestion(engineModule, adapter, record, attempt);
        await appendAttemptLog(attemptLogPath, {
          question_id: record.id,
          attempt: attempt + 1,
          status: 'ok',
          error_type: null,
          started_at: attemptStartedAt,
          completed_at: result.completed_at,
        });
        success = true;
        successResult = result;
        break;
      } catch (error) {
        lastErrorType = classifyFormalError(error);
        const completedAt = new Date().toISOString();
        await appendAttemptLog(attemptLogPath, {
          question_id: record.id,
          attempt: attempt + 1,
          status: 'error',
          error_type: lastErrorType,
          started_at: attemptStartedAt,
          completed_at: completedAt,
        });
        if (!FORMAL_RETRYABLE_ERRORS.has(lastErrorType) || attempt === FORMAL_MAX_RETRIES) break;
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    if (success) {
      const row = adapter.output(record, successResult.answer, {
        ...successResult.diagnostics,
        latency_ms: successResult.latency_ms,
        attempts: actualAttempts,
      });
      await appendResult(resultPath, row);
      completedIds.add(record.id);
      await saveCheckpoint(checkpointPath, options.benchmark, completedIds, terminalErrorIds);
    } else {
      const errorRow = {
        question_id: record.id,
        status: 'error',
        hypothesis: null,
        error_type: lastErrorType,
        attempts: actualAttempts,
      };
      await appendResult(resultPath, errorRow);
      terminalErrorIds.add(record.id);
      await saveCheckpoint(checkpointPath, options.benchmark, completedIds, terminalErrorIds);
    }
  }

  const totalProcessed = completedIds.size + terminalErrorIds.size;
  if (totalProcessed === normalized.length) {
    return lockResults(resultPath, path.join(options.outputRoot, 'results.lock.json'));
  }
  return {
    status: 'incomplete',
    completed: completedIds.size,
    terminal_errors: terminalErrorIds.size,
    expected: normalized.length,
    resultPath,
  };
}

export async function runScoreOnly({ resultPath, lockPath, goldPath, scoreOutputPath, scorer, accessLog, allowedSubset, adapterCommit }) {
  const before = await assertResultsLocked(resultPath, lockPath);
  const goldBytes = await readFile(goldPath);
  const gold = JSON.parse(goldBytes.toString('utf8'));
  if (accessLog) {
    const goldCount = Array.isArray(gold) ? gold.length : Object.keys(gold).length;
    await appendAccessLog(accessLog, {
      dataset_path: goldPath,
      dataset_sha256: await sha256File(goldPath),
      file_size: goldBytes.byteLength,
      dataset_id_count: goldCount,
      allowed_subset: allowedSubset,
      reader_commit: adapterCommit,
      phase: 'scoring',
      accessed_question: false,
      accessed_gold: true,
    });
  }
  const results = (await readFile(resultPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const metrics = await scorer(results, gold);
  await writeFile(scoreOutputPath, `${JSON.stringify({ schema_version: 1, result_sha256: before.result_sha256, metrics }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await assertResultsLocked(resultPath, lockPath);
  return metrics;
}

async function validateOnly() {
  const v1Path = path.join(ROOT, 'preregistration', 'longmemeval-v1.json');
  const v2Path = path.join(ROOT, 'preregistration', 'longmemeval-v2.json');
  const v3Path = path.join(ROOT, 'preregistration', 'longmemeval-v3.json');
  const kimiJudgePath = path.join(ROOT, 'preregistration', 'longmemeval-kimi-judge-v1.json');
  const locomoPath = path.join(ROOT, 'preregistration', 'locomo-heldout-v1.json');

  // 1. v1 preserved (read-only history)
  const v1 = await readJson(v1Path);
  if (v1.product_commit !== PRODUCT_COMMIT || v1.formal_status !== 'NOT AUTHORIZED / NOT RUN') throw new Error('PREREGISTRATION_V1_LOCK_INVALID');

  // 2. v2 preserved (read-only history)
  const v2 = await readJson(v2Path);
  if (v2.product_commit !== PRODUCT_COMMIT) throw new Error('PREREGISTRATION_V2_PRODUCT_COMMIT_MISMATCH');
  if (v2.formal_status !== 'NOT AUTHORIZED / NOT RUN') throw new Error('PREREGISTRATION_V2_FORMAL_STATUS_INVALID');
  if (v2.graph_answer_used !== false) throw new Error('PREREGISTRATION_V2_GRAPH_ANSWER_USED');

  // 3. v3 is current
  const v3 = await readJson(v3Path);
  if (v3.preregistration_version !== 3) throw new Error('PREREGISTRATION_V3_VERSION_INVALID');
  if (v3.supersedes !== 'external-eval/preregistration/longmemeval-v2.json') throw new Error('PREREGISTRATION_V3_SUPERSEDES_INVALID');
  if (v3.formal_status !== 'NOT AUTHORIZED / NOT RUN') throw new Error('PREREGISTRATION_V3_FORMAL_STATUS_INVALID');
  if (v3.formal_dataset_access_before_v3 !== false) throw new Error('PREREGISTRATION_V3_DATASET_ACCESSED_BEFORE_V3');
  if (v3.formal_gold_access_before_v3 !== false) throw new Error('PREREGISTRATION_V3_GOLD_ACCESSED_BEFORE_V3');
  if (v3.product_commit !== PRODUCT_COMMIT) throw new Error('PREREGISTRATION_V3_PRODUCT_COMMIT_MISMATCH');
  if (v3.product_build_sha256 !== 'af487d47018e3005c82684fd2c576524e12fbbb51dee2a64719fba0e255c2668') throw new Error('PREREGISTRATION_V3_PRODUCT_BUILD_HASH_MISMATCH');
  if (v3.official_dataset_schema !== 'parallel_arrays_v1') throw new Error('PREREGISTRATION_V3_OFFICIAL_SCHEMA_INVALID');
  if (v3.session_order_policy !== 'preserve_official_order') throw new Error('PREREGISTRATION_V3_SESSION_ORDER_POLICY_INVALID');
  if (v3.question_envelope_version !== QUESTION_ENVELOPE_VERSION) throw new Error('PREREGISTRATION_V3_ENVELOPE_VERSION_MISMATCH');
  if (v3.question_envelope_sha256 !== QUESTION_ENVELOPE_SHA256) throw new Error('PREREGISTRATION_V3_ENVELOPE_SHA256_MISMATCH');
  if (v3.graph_answer_used !== false) throw new Error('PREREGISTRATION_V3_GRAPH_ANSWER_USED');
  if (v3.answer_model !== 'deepseek-v4-flash') throw new Error('PREREGISTRATION_V3_ANSWER_MODEL_MISMATCH');
  if (v3.answer.temperature !== 0) throw new Error('PREREGISTRATION_V3_TEMPERATURE_MISMATCH');
  if (v3.retrieval.answer_top_k !== 10) throw new Error('PREREGISTRATION_V3_TOP_K_MISMATCH');
  if (v3.scoring_protocol !== 'kimi-longmemeval-judge-v1') throw new Error('PREREGISTRATION_V3_SCORING_PROTOCOL_INVALID');
  if (v3.official_gpt4o_scorer_used !== false) throw new Error('PREREGISTRATION_V3_OFFICIAL_GPT4O_SCORER_USED_INVALID');
  if (v3.leaderboard_comparable !== false) throw new Error('PREREGISTRATION_V3_LEADERBOARD_COMPARABLE_INVALID');
  if (!Array.isArray(v3.primary_metrics) || !v3.primary_metrics.includes('Kimi-K2.6-judged QA accuracy')) throw new Error('PREREGISTRATION_V3_PRIMARY_METRICS_INVALID');

  // 4. Adapter file hash
  const adapterPath = path.join(ROOT, 'adapters', 'longmemeval.mjs');
  const adapterHash = await sha256File(adapterPath);
  if (adapterHash !== v3.adapter_file_sha256) throw new Error('PREREGISTRATION_V3_ADAPTER_FILE_HASH_MISMATCH');

  // 5. Engine file hash
  const engineAdapterPath = path.join(ROOT, 'engines', 'omni-frozen-v3.1.mjs');
  const engineFileHash = await sha256File(engineAdapterPath);
  if (engineFileHash !== v3.engine_adapter_file_sha256) throw new Error('PREREGISTRATION_V3_ENGINE_FILE_HASH_MISMATCH');

  // 6. Formal runner file hash
  const formalRunnerPath = path.join(ROOT, 'runners', 'sealed-runner.mjs');
  const formalRunnerHash = await sha256File(formalRunnerPath);
  if (formalRunnerHash !== v3.formal_runner_file_sha256) throw new Error('PREREGISTRATION_V3_RUNNER_FILE_HASH_MISMATCH');

  // 7. Question envelope hash (already checked above against constants, also verify in v3)
  if (v3.question_envelope_sha256 !== '1e26c66a675a17b74e78dd8d1c6624996143a14b47c5b8753e1c67959fdb96cc') throw new Error('PREREGISTRATION_V3_ENVELOPE_SHA256_CONST_INVALID');

  // 8. Kimi judge prompt hash
  const kimiPromptPath = path.join(ROOT, 'scorers', 'prompts', 'kimi-longmemeval-judge-v1.txt');
  const kimiPromptRaw = await readFile(kimiPromptPath, 'utf8');
  const kimiPromptHash = (await import('node:crypto')).createHash('sha256').update(kimiPromptRaw.replace(/\r\n/g, '\n')).digest('hex');
  if (kimiPromptHash !== v3.kimi_judge_prompt_sha256) throw new Error('PREREGISTRATION_V3_KIMI_PROMPT_HASH_MISMATCH');

  // 9. Judge model
  if (v3.judge_model !== 'kimi-k2.6') throw new Error('PREREGISTRATION_V3_JUDGE_MODEL_INVALID');

  // 10. OpenAI scorer off
  if (v3.official_gpt4o_scorer_used !== false) throw new Error('PREREGISTRATION_V3_OPENAI_SCORER_NOT_OFF');

  // 11. Leaderboard comparable false
  if (v3.leaderboard_comparable !== false) throw new Error('PREREGISTRATION_V3_LEADERBOARD_NOT_FALSE');

  // 12. Product commit and build hash (already checked above)

  // 13. Top-K = 10 (already checked above)

  // 14. Answer temperature = 0 (already checked above)

  // 15. graph_answer = false (already checked above)

  // Kimi judge preregistration
  const kimiJudge = await readJson(kimiJudgePath);
  if (kimiJudge.judge_model !== 'kimi-k2.6') throw new Error('KIMI_JUDGE_PREREG_MODEL_INVALID');
  if (kimiJudge.official_gpt4o_scoring_performed !== false) throw new Error('KIMI_JUDGE_PREREG_GPT4O_INVALID');
  if (kimiJudge.leaderboard_comparable !== false) throw new Error('KIMI_JUDGE_PREREG_LEADERBOARD_INVALID');
  if (kimiJudge.score_based_retry_forbidden !== true) throw new Error('KIMI_JUDGE_PREREG_SCORE_RETRY_INVALID');
  if (kimiJudge.max_output_tokens !== 10) throw new Error('KIMI_JUDGE_PREREG_MAX_TOKENS_INVALID');
  if (kimiJudge.max_retries_after_initial !== 2) throw new Error('KIMI_JUDGE_PREREG_MAX_RETRIES_INVALID');
  if (v3.scoring_preregistration_sha256 !== await sha256File(kimiJudgePath)) throw new Error('PREREGISTRATION_V3_KIMI_JUDGE_HASH_MISMATCH');

  // locomo (preserved)
  const locomo = await readJson(locomoPath);
  if (locomo.product_commit !== PRODUCT_COMMIT || locomo.formal_status !== 'NOT AUTHORIZED / NOT RUN') throw new Error('PREREGISTRATION_LOCOMO_LOCK_INVALID');

  for (const benchmark of ['longmemeval', 'locomo']) assertGoldFree(await readJson(adapterFor(benchmark).fixture));

  return {
    schema_version: 3,
    status: 'VALID',
    formal_run: false,
    heldout_accessed: false,
    engine_adapter_verified: true,
    formal_runner_verified: true,
    kimi_judge_verified: true,
    preregistrations: [
      { file: path.relative(REPO, v1Path).replaceAll('\\', '/'), benchmark: v1.benchmark, version: 1, superseded_by: 'longmemeval-v2.json' },
      { file: path.relative(REPO, v2Path).replaceAll('\\', '/'), benchmark: v2.benchmark, version: 2, superseded_by: 'longmemeval-v3.json' },
      { file: path.relative(REPO, v3Path).replaceAll('\\', '/'), benchmark: v3.benchmark, version: 3, current: true, engine_adapter_commit: v3.engine_adapter_commit, formal_runner_commit: v3.formal_runner_commit },
      { file: path.relative(REPO, kimiJudgePath).replaceAll('\\', '/'), judge_model: kimiJudge.judge_model, version: 1 },
      { file: path.relative(REPO, locomoPath).replaceAll('\\', '/'), benchmark: locomo.benchmark, version: 1 },
    ],
  };
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
  if (process.argv.includes('--score-only')) {
    const authorizationFile = process.env.OMNI_HELDOUT_AUTHORIZATION_FILE;
    if (!authorizationFile) throw new Error('HELDOUT_AUTHORIZATION_REQUIRED:OMNI_HELDOUT_AUTHORIZATION_FILE');
    const adapterCommit = requiredFlag('--adapter-commit');
    const preregistrationPath = path.resolve(requiredFlag('--preregistration'));
    const generationDataPath = path.resolve(requiredFlag('--generation-data'));
    const allowedSubset = requiredFlag('--allowed-subset');
    const preregistrationSha256 = await sha256File(preregistrationPath);
    const datasetSha256 = await sha256File(generationDataPath);
    await loadAuthorization(authorizationFile, {
      benchmark,
      dataset_variant: requiredFlag('--dataset-variant'),
      allowed_subset: allowedSubset,
      dataset_sha256: datasetSha256,
      product_commit: PRODUCT_COMMIT,
      adapter_commit: adapterCommit,
      preregistration_sha256: preregistrationSha256,
    });
    const scorerModulePath = flag('--scorer-module');
    if (!scorerModulePath) throw new Error('OFFICIAL_SCORER_MODULE_REQUIRED');
    const scorerModule = await import(pathToFileURL(path.resolve(scorerModulePath)));
    if (typeof scorerModule.score !== 'function') throw new Error('OFFICIAL_SCORER_INTERFACE_INVALID');
    const metrics = await runScoreOnly({
      resultPath: path.resolve(requiredFlag('--results')),
      lockPath: path.resolve(requiredFlag('--result-lock')),
      goldPath: path.resolve(requiredFlag('--gold')),
      scoreOutputPath: path.resolve(requiredFlag('--score-output')),
      scorer: scorerModule.score,
      accessLog: path.resolve(requiredFlag('--access-log')),
      allowedSubset,
      adapterCommit,
    });
    return console.log(JSON.stringify({ schema_version: 1, status: 'SCORED', metrics }));
  }
  throw new Error('MODE_REQUIRED:--fixture|--validate-only|--formal|--score-only');
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(JSON.stringify({ status: 'REFUSED', error: error.message })); process.exitCode = 1; });
