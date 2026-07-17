#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeLongMemEvalGeneration, toLongMemEvalOfficialOutput, QUESTION_ENVELOPE_VERSION, QUESTION_ENVELOPE_SHA256 } from '../adapters/longmemeval.mjs';
import { normalizeLocomoGeneration, toLocomoOfficialOutput } from '../adapters/locomo.mjs';
import { PRODUCT_COMMIT, appendAccessLog, assertGoldFree, assertResultsLocked, loadAuthorization, loadAuthorizationV2, lockResults, readGenerationProjection, readGoldProjection, sha256File, sha256Bytes, validateAuthorizationV2 } from '../lib/sealed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..');

const FORMAL_RETRYABLE_ERRORS = new Set(['schema_validation', '429', '5xx', 'network', 'timeout']);
const FORMAL_MAX_RETRIES = 2;
const FORMAL_EXPECTED_TOTAL = 500;

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

// --- v1 authorization (preserved for backward compatibility with existing tests) ---

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

// --- Crash recovery: rebuild state from existing results.jsonl ---

/**
 * Read existing results.jsonl and rebuild completed_ids and terminal_error_ids.
 * Verifies that each question_id has at most one terminal result (status 'ok' or 'error').
 * Returns { rows, completed_ids, terminal_error_ids, idCounts }.
 */
export async function rebuildStateFromResults(resultPath) {
  let rows = [];
  if (await exists(resultPath)) {
    const text = await readFile(resultPath, 'utf8');
    rows = text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  }
  const completedIds = new Set();
  const terminalErrorIds = new Set();
  const idCounts = new Map();
  for (const row of rows) {
    const id = row?.question_id;
    if (!id) throw new Error('RESULT_ROW_MISSING_QUESTION_ID');
    idCounts.set(id, (idCounts.get(id) || 0) + 1);
    if (row.status === 'error') {
      // Terminal error row
      if (terminalErrorIds.has(id)) {
        throw new Error(`DUPLICATE_TERMINAL_ERROR_RESULT:${id}`);
      }
      if (completedIds.has(id)) {
        throw new Error(`RESULT_CONFLICT_COMPLETED_AND_ERROR:${id}`);
      }
      terminalErrorIds.add(id);
    } else {
      // Successful generation row (status 'ok' or absent)
      if (completedIds.has(id)) {
        throw new Error(`DUPLICATE_COMPLETED_RESULT:${id}`);
      }
      if (terminalErrorIds.has(id)) {
        throw new Error(`RESULT_CONFLICT_ERROR_AND_COMPLETED:${id}`);
      }
      completedIds.add(id);
    }
  }
  return { rows, completedIds, terminalErrorIds, idCounts };
}

/**
 * Merge checkpoint state with results-derived state.
 * If they conflict (e.g., checkpoint says completed but results say error), stop.
 */
function mergeCheckpointWithResults(checkpoint, resultsState) {
  const { completedIds: rCompleted, terminalErrorIds: rErrors } = resultsState;
  const { completed_ids: cCompleted, terminal_error_ids: cErrors } = checkpoint;

  // Results-derived state is the source of truth (results.jsonl is durable).
  // Checkpoint should be a subset of results state. If checkpoint has an ID that
  // results doesn't have in the corresponding terminal state, that's a conflict.
  for (const id of cCompleted) {
    if (rErrors.has(id)) {
      throw new Error(`CHECKPOINT_RESULTS_CONFLICT:checkpoint_completed_but_results_error:${id}`);
    }
    // If checkpoint says completed but results has no record, results may be stale — trust checkpoint.
  }
  for (const id of cErrors) {
    if (rCompleted.has(id)) {
      throw new Error(`CHECKPOINT_RESULTS_CONFLICT:checkpoint_error_but_results_completed:${id}`);
    }
  }

  // Union: results-derived + checkpoint (in case results.jsonl was lost but checkpoint persists).
  const mergedCompleted = new Set([...rCompleted, ...cCompleted]);
  const mergedErrors = new Set([...rErrors, ...cErrors]);

  // Conflict if an ID is in both completed and errors
  for (const id of mergedCompleted) {
    if (mergedErrors.has(id)) {
      throw new Error(`STATE_CONFLICT_ID_IN_BOTH_COMPLETED_AND_ERROR:${id}`);
    }
  }

  return { completed_ids: mergedCompleted, terminal_error_ids: mergedErrors };
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

  // --- Crash recovery: read existing results first, verify, then merge with checkpoint ---
  const resultsState = await rebuildStateFromResults(resultPath);
  const checkpoint = await loadCheckpoint(checkpointPath);
  const merged = mergeCheckpointWithResults(checkpoint, resultsState);
  const completedIds = merged.completed_ids;
  const terminalErrorIds = merged.terminal_error_ids;

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

/**
 * Validate formal lock conditions before formal scoring:
 *   - unique question_ids = expectedTotal (default 500)
 *   - result terminal rows = expectedTotal
 *   - duplicate question_ids = 0
 *   - completed + generation_terminal_errors = expectedTotal
 */
export function validateFormalLock(results, expectedTotal = FORMAL_EXPECTED_TOTAL) {
  if (!Array.isArray(results)) throw new Error('FORMAL_LOCK_RESULTS_NOT_ARRAY');
  const ids = new Set();
  let duplicates = 0;
  let completed = 0;
  let terminalErrors = 0;
  for (const row of results) {
    const id = row?.question_id;
    if (!id) throw new Error('FORMAL_LOCK_ROW_MISSING_QUESTION_ID');
    if (ids.has(id)) duplicates++;
    else ids.add(id);
    if (row.status === 'error') terminalErrors++;
    else completed++;
  }
  if (duplicates !== 0) {
    throw new Error(`FORMAL_LOCK_DUPLICATE_IDS:${duplicates}`);
  }
  if (ids.size !== expectedTotal) {
    throw new Error(`FORMAL_LOCK_UNIQUE_IDS_MISMATCH:expected_${expectedTotal}_actual_${ids.size}`);
  }
  if (results.length !== expectedTotal) {
    throw new Error(`FORMAL_LOCK_RESULT_ROWS_MISMATCH:expected_${expectedTotal}_actual_${results.length}`);
  }
  if (completed + terminalErrors !== expectedTotal) {
    throw new Error(`FORMAL_LOCK_TERMINAL_SUM_MISMATCH:completed_${completed}_errors_${terminalErrors}_expected_${expectedTotal}`);
  }
  return { unique_ids: ids.size, result_rows: results.length, duplicates, completed, terminal_errors: terminalErrors };
}

/**
 * Score-only entrypoint (v2-aware). Uses Authorization Schema v2 phase='scoring'.
 * Verifies Gold projection hash BEFORE parsing. Does NOT start product service.
 */
export async function runScoreOnly({
  resultPath,
  lockPath,
  goldPath,
  scoreOutputPath,
  scorer,
  accessLog,
  allowedSubset,
  adapterCommit,
  // v2 phase-separated authorization:
  authorizationFile,
  expected = {},
  fullScoreLogDir,
  sanitizedScoreLogPath,
  enforceFormalChecks = false,
  expectedTotalQuestions = FORMAL_EXPECTED_TOTAL,
}) {
  // Verify results are locked and capture result_sha256
  const lock = await assertResultsLocked(resultPath, lockPath);
  const resultSha256 = lock.result_sha256;

  // v2 phase-separated authorization for scoring
  if (authorizationFile) {
    const auth = await loadAuthorizationV2(authorizationFile, {
      ...expected,
      gold_projection_sha256: expected.gold_projection_sha256,
      product_commit: PRODUCT_COMMIT,
    }, 'scoring');
    // result_sha256 is required for scoring phase
    if (!auth.result_sha256) throw new Error('RESULT_SHA256_REQUIRED_FOR_SCORING');
    if (auth.result_sha256 !== resultSha256) {
      throw new Error(`RESULT_SHA256_MISMATCH:auth_${auth.result_sha256}_lock_${resultSha256}`);
    }
    // scoring_preregistration_sha256, scorer_module_sha256, judge_prompt_sha256 are validated by loadAuthorizationV2
  }

  // Read Gold bytes, compute SHA-256, compare to expected, then parse
  const goldSha256 = expected.gold_projection_sha256 || (await sha256File(goldPath));
  const { parsed: gold, sha256: verifiedGoldSha256 } = await readGoldProjection(goldPath, goldSha256);

  if (accessLog) {
    const goldCount = Array.isArray(gold) ? gold.length : Object.keys(gold).length;
    await appendAccessLog(accessLog, {
      dataset_path: goldPath,
      dataset_sha256: verifiedGoldSha256,
      file_size: (await readFile(goldPath)).byteLength,
      dataset_id_count: goldCount,
      allowed_subset: allowedSubset,
      reader_commit: adapterCommit,
      phase: 'scoring',
      accessed_question: false,
      accessed_gold: true,
    });
  }

  const results = (await readFile(resultPath, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);

  // Formal lock validation (when enforceFormalChecks)
  if (enforceFormalChecks) {
    validateFormalLock(results, expectedTotalQuestions);
  }

  const metrics = await scorer(results, gold, {
    fullLogDir: fullScoreLogDir,
    sanitizedLogPath: sanitizedScoreLogPath,
    enforceFormalChecks,
    expectedTotalQuestions,
  });

  const manifest = {
    schema_version: 2,
    result_sha256: resultSha256,
    gold_projection_sha256: verifiedGoldSha256,
    metrics,
    log_manifest: metrics?.log_manifest || null,
  };
  await writeFile(scoreOutputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await assertResultsLocked(resultPath, lockPath);
  return metrics;
}

async function validateOnly() {
  const v1Path = path.join(ROOT, 'preregistration', 'longmemeval-v1.json');
  const v2Path = path.join(ROOT, 'preregistration', 'longmemeval-v2.json');
  const v3Path = path.join(ROOT, 'preregistration', 'longmemeval-v3.json');
  const v4Path = path.join(ROOT, 'preregistration', 'longmemeval-v4.json');
  const v4MdPath = path.join(ROOT, 'preregistration', 'longmemeval-v4.md');
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

  // 3. v3 preserved (read-only history, superseded by v4)
  const v3 = await readJson(v3Path);
  if (v3.preregistration_version !== 3) throw new Error('PREREGISTRATION_V3_VERSION_INVALID');
  if (v3.supersedes !== 'external-eval/preregistration/longmemeval-v2.json') throw new Error('PREREGISTRATION_V3_SUPERSEDES_INVALID');
  if (v3.formal_status !== 'NOT AUTHORIZED / NOT RUN') throw new Error('PREREGISTRATION_V3_FORMAL_STATUS_INVALID');
  if (v3.product_commit !== PRODUCT_COMMIT) throw new Error('PREREGISTRATION_V3_PRODUCT_COMMIT_MISMATCH');

  // 4. v4 is current
  if (!await exists(v4Path)) throw new Error('PREREGISTRATION_V4_MISSING');
  if (!await exists(v4MdPath)) throw new Error('PREREGISTRATION_V4_MD_MISSING');
  const v4 = await readJson(v4Path);
  if (v4.preregistration_version !== 4) throw new Error('PREREGISTRATION_V4_VERSION_INVALID');
  if (v4.supersedes !== 'external-eval/preregistration/longmemeval-v3.json') throw new Error('PREREGISTRATION_V4_SUPERSEDES_INVALID');
  if (v4.formal_status !== 'NOT AUTHORIZED / NOT RUN') throw new Error('PREREGISTRATION_V4_FORMAL_STATUS_INVALID');
  if (v4.formal_dataset_access_before_v4 !== false) throw new Error('PREREGISTRATION_V4_DATASET_ACCESSED_BEFORE_V4');
  if (v4.formal_gold_access_before_v4 !== false) throw new Error('PREREGISTRATION_V4_GOLD_ACCESSED_BEFORE_V4');
  if (v4.formal_500_run_before_v4 !== false) throw new Error('PREREGISTRATION_V4_500_RUN_BEFORE_V4');
  if (v4.product_commit !== PRODUCT_COMMIT) throw new Error('PREREGISTRATION_V4_PRODUCT_COMMIT_MISMATCH');
  if (v4.product_build_sha256 !== 'af487d47018e3005c82684fd2c576524e12fbbb51dee2a64719fba0e255c2668') throw new Error('PREREGISTRATION_V4_PRODUCT_BUILD_HASH_MISMATCH');
  if (v4.question_envelope_version !== QUESTION_ENVELOPE_VERSION) throw new Error('PREREGISTRATION_V4_ENVELOPE_VERSION_MISMATCH');
  if (v4.question_envelope_sha256 !== QUESTION_ENVELOPE_SHA256) throw new Error('PREREGISTRATION_V4_ENVELOPE_SHA256_MISMATCH');
  if (v4.graph_answer_used !== false) throw new Error('PREREGISTRATION_V4_GRAPH_ANSWER_USED');
  if (v4.answer_model !== 'deepseek-v4-flash') throw new Error('PREREGISTRATION_V4_ANSWER_MODEL_MISMATCH');
  if (v4.answer.temperature !== 0) throw new Error('PREREGISTRATION_V4_TEMPERATURE_MISMATCH');
  if (v4.retrieval.answer_top_k !== 10) throw new Error('PREREGISTRATION_V4_TOP_K_MISMATCH');
  if (v4.scoring_protocol !== 'kimi-longmemeval-judge-v1') throw new Error('PREREGISTRATION_V4_SCORING_PROTOCOL_INVALID');
  if (v4.official_gpt4o_scorer_used !== false) throw new Error('PREREGISTRATION_V4_OFFICIAL_GPT4O_SCORER_USED_INVALID');
  if (v4.leaderboard_comparable !== false) throw new Error('PREREGISTRATION_V4_LEADERBOARD_COMPARABLE_INVALID');

  // Engine commit must equal 55f793b...
  const EXPECTED_ENGINE_COMMIT = '55f793be55fe14002d49a4c3bb577ee1255a30f9';
  const EXPECTED_ENGINE_HASH = '330ea359b09f1071c5e21ae6a293503dff74cb99ef4bd4860506503a82756d82';
  if (v4.engine_adapter_commit !== EXPECTED_ENGINE_COMMIT) {
    throw new Error(`PREREGISTRATION_V4_ENGINE_COMMIT_MISMATCH:expected_${EXPECTED_ENGINE_COMMIT}_actual_${v4.engine_adapter_commit}`);
  }
  if (v4.engine_adapter_file_sha256 !== EXPECTED_ENGINE_HASH) {
    throw new Error(`PREREGISTRATION_V4_ENGINE_HASH_MISMATCH:expected_${EXPECTED_ENGINE_HASH}_actual_${v4.engine_adapter_file_sha256}`);
  }

  // Primary metrics fixed
  const requiredPrimaryMetrics = [
    'Kimi-K2.6-judged end-to-end QA accuracy',
    'generation completion rate',
    'generation terminal error rate',
    'Kimi judge completion rate',
    'Kimi judge error rate',
  ];
  if (!Array.isArray(v4.primary_metrics)) throw new Error('PREREGISTRATION_V4_PRIMARY_METRICS_NOT_ARRAY');
  for (const metric of requiredPrimaryMetrics) {
    if (!v4.primary_metrics.includes(metric)) {
      throw new Error(`PREREGISTRATION_V4_PRIMARY_METRIC_MISSING:${metric}`);
    }
  }

  // Authorization schema version 2
  if (v4.authorization_schema_version !== 2) throw new Error('PREREGISTRATION_V4_AUTH_SCHEMA_VERSION_INVALID');

  // File hashes — verify all referenced files match
  const adapterPath = path.join(ROOT, 'adapters', 'longmemeval.mjs');
  const adapterHash = await sha256File(adapterPath);
  if (adapterHash !== v4.adapter_file_sha256) throw new Error('PREREGISTRATION_V4_ADAPTER_FILE_HASH_MISMATCH');

  const engineAdapterPath = path.join(ROOT, 'engines', 'omni-frozen-v3.1.mjs');
  const engineFileHash = await sha256File(engineAdapterPath);
  if (engineFileHash !== v4.engine_adapter_file_sha256) throw new Error('PREREGISTRATION_V4_ENGINE_FILE_HASH_MISMATCH');

  const formalRunnerPath = path.join(ROOT, 'runners', 'sealed-runner.mjs');
  const formalRunnerHash = await sha256File(formalRunnerPath);
  if (formalRunnerHash !== v4.formal_runner_file_sha256) throw new Error('PREREGISTRATION_V4_RUNNER_FILE_HASH_MISMATCH');

  const kimiScorerPath = path.join(ROOT, 'scorers', 'kimi-longmemeval-v1.mjs');
  const kimiScorerHash = await sha256File(kimiScorerPath);
  if (kimiScorerHash !== v4.kimi_scorer_module_sha256) throw new Error('PREREGISTRATION_V4_KIMI_SCORER_FILE_HASH_MISMATCH');

  const kimiPromptPath = path.join(ROOT, 'scorers', 'prompts', 'kimi-longmemeval-judge-v1.txt');
  const kimiPromptRaw = await readFile(kimiPromptPath, 'utf8');
  const kimiPromptHash = (await import('node:crypto')).createHash('sha256').update(kimiPromptRaw.replace(/\r\n/g, '\n')).digest('hex');
  if (kimiPromptHash !== v4.kimi_judge_prompt_sha256) throw new Error('PREREGISTRATION_V4_KIMI_PROMPT_HASH_MISMATCH');

  const kimiSchemaPath = path.join(ROOT, 'scorers', 'schemas', 'kimi-longmemeval-judge-v1.json');
  const kimiSchemaHash = await sha256File(kimiSchemaPath);
  if (kimiSchemaHash !== v4.kimi_judge_schema_sha256) throw new Error('PREREGISTRATION_V4_KIMI_SCHEMA_HASH_MISMATCH');

  // Kimi judge preregistration
  const kimiJudge = await readJson(kimiJudgePath);
  if (kimiJudge.judge_model !== 'kimi-k2.6') throw new Error('KIMI_JUDGE_PREREG_MODEL_INVALID');
  if (kimiJudge.official_gpt4o_scoring_performed !== false) throw new Error('KIMI_JUDGE_PREREG_GPT4O_INVALID');
  if (kimiJudge.leaderboard_comparable !== false) throw new Error('KIMI_JUDGE_PREREG_LEADERBOARD_INVALID');
  if (kimiJudge.score_based_retry_forbidden !== true) throw new Error('KIMI_JUDGE_PREREG_SCORE_RETRY_INVALID');
  if (kimiJudge.max_output_tokens !== 10) throw new Error('KIMI_JUDGE_PREREG_MAX_TOKENS_INVALID');
  if (kimiJudge.max_retries_after_initial !== 2) throw new Error('KIMI_JUDGE_PREREG_MAX_RETRIES_INVALID');
  // Sanitized log must include generation_status
  if (!Array.isArray(kimiJudge.sanitized_log_fields) || !kimiJudge.sanitized_log_fields.includes('generation_status')) {
    throw new Error('KIMI_JUDGE_PREREG_SANITIZED_LOG_MISSING_GENERATION_STATUS');
  }
  if (v4.scoring_preregistration_sha256 !== await sha256File(kimiJudgePath)) throw new Error('PREREGISTRATION_V4_KIMI_JUDGE_HASH_MISMATCH');

  // locomo (preserved)
  const locomo = await readJson(locomoPath);
  if (locomo.product_commit !== PRODUCT_COMMIT || locomo.formal_status !== 'NOT AUTHORIZED / NOT RUN') throw new Error('PREREGISTRATION_LOCOMO_LOCK_INVALID');

  for (const benchmark of ['longmemeval', 'locomo']) assertGoldFree(await readJson(adapterFor(benchmark).fixture));

  return {
    schema_version: 4,
    status: 'VALID',
    formal_run: false,
    heldout_accessed: false,
    engine_adapter_verified: true,
    formal_runner_verified: true,
    kimi_judge_verified: true,
    authorization_schema_version: 2,
    gold_hash_required_for_scoring: true,
    result_hash_required_for_scoring: true,
    judge_prompt_hash_required_for_scoring: true,
    generation_error_not_abstention: true,
    id_uniqueness_gated: true,
    max_kimi_logical_calls: 500,
    formal_log_paths_required: true,
    openai_scorer_off: true,
    leaderboard_comparable: false,
    formal_data_accessed: false,
    preregistrations: [
      { file: path.relative(REPO, v1Path).replaceAll('\\', '/'), benchmark: v1.benchmark, version: 1, superseded_by: 'longmemeval-v2.json' },
      { file: path.relative(REPO, v2Path).replaceAll('\\', '/'), benchmark: v2.benchmark, version: 2, superseded_by: 'longmemeval-v3.json' },
      { file: path.relative(REPO, v3Path).replaceAll('\\', '/'), benchmark: v3.benchmark, version: 3, superseded_by: 'longmemeval-v4.json' },
      { file: path.relative(REPO, v4Path).replaceAll('\\', '/'), benchmark: v4.benchmark, version: 4, current: true, engine_adapter_commit: v4.engine_adapter_commit, formal_runner_commit: v4.formal_runner_commit, authorization_schema_version: v4.authorization_schema_version },
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

    // Try v2 first; fall back to v1 for backward compat with existing tests
    const useV2 = flag('--auth-schema-version') === '2' || flag('--auth-v2') === 'true';
    let authExpectedV2;
    if (useV2) {
      authExpectedV2 = {
        benchmark,
        dataset_variant: requiredFlag('--dataset-variant'),
        allowed_subset: allowedSubset,
        generation_projection_sha256: datasetSha256,
        product_commit: PRODUCT_COMMIT,
        adapter_commit: adapterCommit,
        preregistration_sha256: preregistrationSha256,
      };
      await loadAuthorizationV2(authorizationFile, authExpectedV2, 'scoring');
    } else {
      await loadAuthorization(authorizationFile, {
        benchmark,
        dataset_variant: requiredFlag('--dataset-variant'),
        allowed_subset: allowedSubset,
        dataset_sha256: datasetSha256,
        product_commit: PRODUCT_COMMIT,
        adapter_commit: adapterCommit,
        preregistration_sha256: preregistrationSha256,
      });
    }

    const scorerModulePath = flag('--scorer-module');
    if (!scorerModulePath) throw new Error('SCORER_MODULE_REQUIRED');
    const scorerModule = await import(pathToFileURL(path.resolve(scorerModulePath)));
    if (typeof scorerModule.score !== 'function') throw new Error('SCORER_INTERFACE_INVALID');

    const fullScoreLogDir = flag('--full-score-log-dir');
    const sanitizedScoreLog = flag('--sanitized-score-log');
    const enforceFormal = process.argv.includes('--enforce-formal-checks');

    // For formal scoring, both log paths are required
    if (enforceFormal) {
      if (!fullScoreLogDir) throw new Error('FULL_SCORE_LOG_DIR_REQUIRED');
      if (!sanitizedScoreLog) throw new Error('SANITIZED_SCORE_LOG_PATH_REQUIRED');
    }

    const goldPath = path.resolve(requiredFlag('--gold'));
    const goldSha256 = useV2 ? (await sha256File(goldPath)) : undefined;

    const metrics = await runScoreOnly({
      resultPath: path.resolve(requiredFlag('--results')),
      lockPath: path.resolve(requiredFlag('--result-lock')),
      goldPath,
      scoreOutputPath: path.resolve(requiredFlag('--score-output')),
      scorer: scorerModule.score,
      accessLog: path.resolve(requiredFlag('--access-log')),
      allowedSubset,
      adapterCommit,
      authorizationFile: useV2 ? authorizationFile : undefined,
      expected: useV2 ? { ...authExpectedV2, gold_projection_sha256: goldSha256 } : undefined,
      fullScoreLogDir: fullScoreLogDir ? path.resolve(fullScoreLogDir) : undefined,
      sanitizedScoreLogPath: sanitizedScoreLog ? path.resolve(sanitizedScoreLog) : undefined,
      enforceFormalChecks: enforceFormal,
      expectedTotalQuestions: parseInt(flag('--expected-total', '500'), 10),
    });
    return console.log(JSON.stringify({ schema_version: 2, status: 'SCORED', metrics }));
  }
  throw new Error('MODE_REQUIRED:--fixture|--validate-only|--formal|--score-only');
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(JSON.stringify({ status: 'REFUSED', error: error.message })); process.exitCode = 1; });
