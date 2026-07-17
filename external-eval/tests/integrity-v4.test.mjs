import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PRODUCT_COMMIT,
  validateAuthorizationV2,
  readGoldProjection,
  sha256File,
  sha256Bytes,
} from '../lib/sealed.mjs';
import {
  rebuildStateFromResults,
  runFormalGeneration,
  runScoreOnly,
  validateFormalLock,
} from '../runners/sealed-runner.mjs';
import { scoreWithDeps, METRIC_NAME } from '../scorers/kimi-longmemeval-v1.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_ROOT = 'D:\\OmniContext-research-runs\\external\\test-temp';
const ADAPTER_COMMIT = '1234567890abcdef1234567890abcdef12345678';
const MOCK_ENGINE_PATH = path.join(ROOT, 'tests', 'mock-engine.mjs');

async function tempDir(t) {
  await mkdir(TEMP_ROOT, { recursive: true });
  const dir = await mkdtemp(path.join(TEMP_ROOT, 'v4-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function digest(value) { return createHash('sha256').update(value).digest('hex'); }

function makeResult(questionId, hypothesis, abstained = false) {
  return { question_id: questionId, hypothesis, abstained };
}

function makeErrorResult(questionId, errorType = 'unknown', attempts = 3) {
  return { question_id: questionId, status: 'error', hypothesis: null, error_type: errorType, attempts };
}

function makeGold(questionId, questionType, question, answer) {
  return { question_id: questionId, question_type: questionType, question, answer };
}

function makeMockMoonshot(responses) {
  let callIndex = 0;
  return async () => {
    const response = responses[Math.min(callIndex, responses.length - 1)];
    callIndex++;
    if (response.error) throw new Error(response.error);
    return { content: response.content, usage: response.usage || { total_tokens: 10 } };
  };
}

function validAuthV2(overrides = {}) {
  return {
    schema_version: 2,
    authorized_by: 'test-custodian',
    authorized_at: new Date(Date.now() - 60000).toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    benchmark: 'longmemeval',
    dataset_variant: 'test',
    allowed_subset: 'test-only',
    generation_projection_sha256: 'a'.repeat(64),
    gold_projection_sha256: 'b'.repeat(64),
    product_commit: PRODUCT_COMMIT,
    product_build_sha256: 'af487d47018e3005c82684fd2c576524e12fbbb51dee2a64719fba0e255c2668',
    adapter_commit: ADAPTER_COMMIT,
    engine_adapter_commit: '55f793be55fe14002d49a4c3bb577ee1255a30f9',
    formal_runner_commit: 'c'.repeat(40),
    preregistration_sha256: 'd'.repeat(64),
    scoring_preregistration_sha256: 'e'.repeat(64),
    scorer_module_sha256: 'f'.repeat(64),
    judge_prompt_sha256: '6d4cfa724d722553ea79511769fd842afdadfa4cc412de4852dd43ade17448af',
    allow_formal_generation: true,
    allow_formal_scoring: true,
    ...overrides,
  };
}

// === Test 1: Engine Commit and file hash binding ===
test('v4 integrity: engine file hash matches 330ea359... and commit is 55f793b...', async () => {
  const enginePath = path.join(ROOT, 'engines', 'omni-frozen-v3.1.mjs');
  const hash = await sha256File(enginePath);
  assert.equal(hash, '330ea359b09f1071c5e21ae6a293503dff74cb99ef4bd4860506503a82756d82');
  // Verify commit via git log
  const result = spawnSync('git', ['log', '--format=%H', '-n', '1', '--', 'external-eval/engines/omni-frozen-v3.1.mjs'], {
    cwd: path.resolve(ROOT, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  const commit = result.stdout.trim();
  assert.equal(commit, '55f793be55fe14002d49a4c3bb577ee1255a30f9');
});

// === Test 2: Gold hash mismatch rejected ===
test('v4 integrity: wrong Gold hash is rejected before parsing', async (t) => {
  const dir = await tempDir(t);
  const goldPath = path.join(dir, 'gold.json');
  const goldContent = JSON.stringify([makeGold('q1', 'single-session-user', 'Q?', 'A')]);
  await writeFile(goldPath, goldContent);
  const wrongHash = '0'.repeat(64);
  await assert.rejects(
    () => readGoldProjection(goldPath, wrongHash),
    /GOLD_PROJECTION_SHA256_MISMATCH/,
  );
});

// === Test 3: Result hash mismatch rejected ===
test('v4 integrity: wrong result_sha256 is rejected for scoring', async (t) => {
  const dir = await tempDir(t);
  const resultPath = path.join(dir, 'results.jsonl');
  const lockPath = path.join(dir, 'results.lock.json');
  const goldPath = path.join(dir, 'gold.json');
  const metricsPath = path.join(dir, 'metrics.json');
  const authPath = path.join(dir, 'auth.json');
  const accessLog = path.join(dir, 'data-access.jsonl');

  const resultsContent = JSON.stringify({ question_id: 'q1', hypothesis: 'x' }) + '\n';
  await writeFile(resultPath, resultsContent);
  const goldContent = JSON.stringify([makeGold('q1', 'single-session-user', 'Q?', 'A')]);
  await writeFile(goldPath, goldContent);

  // Lock results
  const { lockResults } = await import('../lib/sealed.mjs');
  await lockResults(resultPath, lockPath);

  // Create auth v2 with wrong result_sha256
  const goldHash = digest(goldContent);
  const auth = validAuthV2({
    gold_projection_sha256: goldHash,
    result_sha256: '0'.repeat(64), // wrong hash
  });
  await writeFile(authPath, JSON.stringify(auth));

  await assert.rejects(
    () => runScoreOnly({
      resultPath, lockPath, goldPath, scoreOutputPath: metricsPath,
      scorer: () => ({}), accessLog, allowedSubset: 'test-only', adapterCommit: ADAPTER_COMMIT,
      authorizationFile: authPath,
      expected: { gold_projection_sha256: goldHash },
    }),
    /RESULT_SHA256_MISMATCH/,
  );
});

// === Test 4: Scorer hash mismatch rejected ===
test('v4 integrity: wrong scorer_module_sha256 is rejected', () => {
  const auth = validAuthV2({ scorer_module_sha256: '0'.repeat(64) });
  assert.throws(
    () => validateAuthorizationV2(auth, { scorer_module_sha256: 'f'.repeat(64) }, 'scoring'),
    /AUTHORIZATION_V2_MISMATCH:scorer_module_sha256/,
  );
});

// === Test 5: Judge prompt hash mismatch rejected ===
test('v4 integrity: wrong judge_prompt_sha256 is rejected', () => {
  const auth = validAuthV2({ judge_prompt_sha256: '0'.repeat(64) });
  assert.throws(
    () => validateAuthorizationV2(auth, { judge_prompt_sha256: '6d4cfa724d722553ea79511769fd842afdadfa4cc412de4852dd43ade17448af' }, 'scoring'),
    /AUTHORIZATION_V2_MISMATCH:judge_prompt_sha256/,
  );
});

// === Test 6: Generation error does not call Kimi ===
test('v4 integrity: generation error does not call Kimi', async () => {
  const results = [
    makeResult('q1', 'Correct answer'),
    makeErrorResult('q2', '429', 3),
  ];
  const gold = [
    makeGold('q1', 'single-session-user', 'Q1?', 'Correct answer'),
    makeGold('q2', 'single-session-user', 'Q2?', 'Other answer'),
  ];
  let callCount = 0;
  const callMoonshot = async () => { callCount++; return { content: '{"label":"yes"}', usage: { total_tokens: 10 } }; };
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(callCount, 1, 'Kimi must be called only for successful generation (q1), not for generation error (q2)');
  assert.equal(metrics.kimi_calls, 1);
  assert.equal(metrics.generation_completed, 1);
  assert.equal(metrics.generation_terminal_errors, 1);
});

// === Test 7: Generation error counts as incorrect in end-to-end accuracy ===
test('v4 integrity: generation error counts as incorrect in end_to_end_accuracy', async () => {
  const results = [
    makeResult('q1', 'Correct answer'),
    makeErrorResult('q2', '429', 3),
  ];
  const gold = [
    makeGold('q1', 'single-session-user', 'Q1?', 'Correct answer'),
    makeGold('q2', 'single-session-user', 'Q2?', 'Other answer'),
  ];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 1);
  assert.equal(metrics.total_questions, 2);
  assert.equal(metrics.end_to_end_accuracy, 0.5, 'generation error counts as incorrect');
  assert.equal(metrics.generation_terminal_errors, 1);
});

// === Test 8: Judge error counts as incorrect in end-to-end accuracy ===
test('v4 integrity: judge error counts as incorrect in end_to_end_accuracy', async () => {
  const results = [
    makeResult('q1', 'Correct answer'),
    makeResult('q2', 'Other answer'),
  ];
  const gold = [
    makeGold('q1', 'single-session-user', 'Q1?', 'Correct answer'),
    makeGold('q2', 'single-session-user', 'Q2?', 'Other answer'),
  ];
  const callMoonshot = makeMockMoonshot([
    { content: '{"label":"yes"}' },
    { content: '{"label":"maybe"}' }, // will fail 3 times
    { content: '{"label":"maybe"}' },
    { content: '{"label":"maybe"}' },
  ]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.correct, 1);
  assert.equal(metrics.total_questions, 2);
  assert.equal(metrics.end_to_end_accuracy, 0.5, 'judge error counts as incorrect');
  assert.equal(metrics.kimi_judge_errors, 1);
  assert.equal(metrics.generation_terminal_errors, 0);
});

// === Test 9: Generation and judge error rates are separately calculated ===
test('v4 integrity: generation_terminal_error_rate and kimi_judge_error_rate are separate', async () => {
  const results = [
    makeResult('q1', 'Correct answer'),
    makeErrorResult('q2', '429', 3),
    makeResult('q3', 'Wrong answer'),
  ];
  const gold = [
    makeGold('q1', 'single-session-user', 'Q1?', 'Correct answer'),
    makeGold('q2', 'single-session-user', 'Q2?', 'Other answer'),
    makeGold('q3', 'single-session-user', 'Q3?', 'Correct answer'),
  ];
  const callMoonshot = makeMockMoonshot([
    { content: '{"label":"yes"}' },
    { content: '{"label":"no"}' },
  ]);
  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.total_questions, 3);
  assert.equal(metrics.generation_completed, 2);
  assert.equal(metrics.generation_terminal_errors, 1);
  assert.equal(metrics.generation_terminal_error_rate, 1 / 3);
  assert.equal(metrics.kimi_judge_errors, 0);
  assert.equal(metrics.kimi_judge_error_rate, 0);
  assert.equal(metrics.kimi_judge_completion_rate, 1);
  assert.equal(metrics.correct, 1);
  assert.equal(metrics.end_to_end_accuracy, 1 / 3);
});

// === Test 10: Duplicate result IDs rejected ===
test('v4 integrity: duplicate result IDs are rejected under enforceFormalChecks', async (t) => {
  const dir = await tempDir(t);
  const results = [
    makeResult('q1', 'A'),
    makeResult('q1', 'B'), // duplicate
  ];
  const gold = [
    makeGold('q1', 'single-session-user', 'Q?', 'A'),
    makeGold('q1', 'single-session-user', 'Q?', 'A'),
  ];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  await assert.rejects(
    () => scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key', enforceFormalChecks: true, expectedTotalQuestions: 2, fullLogDir: dir, sanitizedLogPath: path.join(dir, 'sanitized.jsonl') } }),
    /RESULTS_DUPLICATE_QUESTION_ID/,
  );
});

// === Test 11: Duplicate gold IDs rejected ===
test('v4 integrity: duplicate gold IDs are rejected under enforceFormalChecks', async (t) => {
  const dir = await tempDir(t);
  const results = [
    makeResult('q1', 'A'),
    makeResult('q2', 'B'),
  ];
  const gold = [
    makeGold('q1', 'single-session-user', 'Q1?', 'A'),
    makeGold('q1', 'single-session-user', 'Q1?', 'A'), // duplicate
  ];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  await assert.rejects(
    () => scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key', enforceFormalChecks: true, expectedTotalQuestions: 2, fullLogDir: dir, sanitizedLogPath: path.join(dir, 'sanitized.jsonl') } }),
    /GOLD_DUPLICATE_QUESTION_ID/,
  );
});

// === Test 12: ID set mismatch rejected ===
test('v4 integrity: mismatched result/gold ID sets are rejected', async (t) => {
  const dir = await tempDir(t);
  const results = [
    makeResult('q1', 'A'),
    makeResult('q2', 'B'),
  ];
  const gold = [
    makeGold('q1', 'single-session-user', 'Q1?', 'A'),
    makeGold('q3', 'single-session-user', 'Q3?', 'C'), // q3 not in results, q2 not in gold
  ];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  await assert.rejects(
    () => scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key', enforceFormalChecks: true, expectedTotalQuestions: 2, fullLogDir: dir, sanitizedLogPath: path.join(dir, 'sanitized.jsonl') } }),
    /(GOLD_MISSING_QUESTION_ID|RESULTS_MISSING_QUESTION_ID)/,
  );
});

// === Test 13: Non-500 count rejected for formal scoring ===
test('v4 integrity: non-500 count rejected under enforceFormalChecks', async (t) => {
  const dir = await tempDir(t);
  const results = [
    makeResult('q1', 'A'),
    makeResult('q2', 'B'),
  ];
  const gold = [
    makeGold('q1', 'single-session-user', 'Q1?', 'A'),
    makeGold('q2', 'single-session-user', 'Q2?', 'B'),
  ];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  await assert.rejects(
    () => scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key', enforceFormalChecks: true, expectedTotalQuestions: 500, fullLogDir: dir, sanitizedLogPath: path.join(dir, 'sanitized.jsonl') } }),
    /RESULTS_COUNT_MISMATCH/,
  );
});

// === Test 14: Kimi logical calls do not exceed limit ===
test('v4 integrity: kimi_calls <= generation_completed <= expectedTotalQuestions', async (t) => {
  const dir = await tempDir(t);
  const results = [
    makeResult('q1', 'A'),
    makeResult('q2', 'B'),
    makeErrorResult('q3', '429', 3),
  ];
  const gold = [
    makeGold('q1', 'single-session-user', 'Q1?', 'A'),
    makeGold('q2', 'single-session-user', 'Q2?', 'B'),
    makeGold('q3', 'single-session-user', 'Q3?', 'C'),
  ];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  const metrics = await scoreWithDeps({
    results, gold,
    deps: { callMoonshot, apiKey: 'test-key', enforceFormalChecks: true, expectedTotalQuestions: 3, fullLogDir: dir, sanitizedLogPath: path.join(dir, 'sanitized.jsonl') },
  });
  assert.equal(metrics.kimi_calls, 2);
  assert.equal(metrics.generation_completed, 2);
  assert.equal(metrics.total_questions, 3);
  assert.ok(metrics.kimi_calls <= metrics.generation_completed, 'kimi_calls must be <= generation_completed');
  assert.ok(metrics.kimi_calls <= 500, 'kimi_calls must be <= 500');
});

// === Test 15: Missing full score log path rejected ===
test('v4 integrity: missing fullScoreLogDir rejected under enforceFormalChecks', async () => {
  const results = [makeResult('q1', 'A')];
  const gold = [makeGold('q1', 'single-session-user', 'Q?', 'A')];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  await assert.rejects(
    () => scoreWithDeps({
      results, gold,
      deps: { callMoonshot, apiKey: 'test-key', enforceFormalChecks: true, expectedTotalQuestions: 1, sanitizedLogPath: '/tmp/sanitized.jsonl' },
    }),
    /FULL_SCORE_LOG_DIR_REQUIRED/,
  );
});

// === Test 16: Missing sanitized score log path rejected ===
test('v4 integrity: missing sanitizedLogPath rejected under enforceFormalChecks', async () => {
  const results = [makeResult('q1', 'A')];
  const gold = [makeGold('q1', 'single-session-user', 'Q?', 'A')];
  const callMoonshot = makeMockMoonshot([{ content: '{"label":"yes"}' }]);
  await assert.rejects(
    () => scoreWithDeps({
      results, gold,
      deps: { callMoonshot, apiKey: 'test-key', enforceFormalChecks: true, expectedTotalQuestions: 1, fullLogDir: '/tmp/full-logs' },
    }),
    /SANITIZED_SCORE_LOG_PATH_REQUIRED/,
  );
});

// === Test 17: Crash recovery — result written but checkpoint not updated ===
test('v4 integrity: crash after result append but before checkpoint does not re-run question', async (t) => {
  const dir = await tempDir(t);
  const records = [
    {
      question_id: 'q1',
      question_type: 'single-session-user',
      question: 'Question for q1',
      question_date: '2026-01-12',
      haystack_session_ids: ['s1'],
      haystack_dates: ['2026-01-01T09:00:00Z'],
      haystack_sessions: [[{ role: 'user', content: 'Hello.' }]],
    },
    {
      question_id: 'q2',
      question_type: 'single-session-user',
      question: 'Question for q2',
      question_date: '2026-01-12',
      haystack_session_ids: ['s1'],
      haystack_dates: ['2026-01-01T09:00:00Z'],
      haystack_sessions: [[{ role: 'user', content: 'Hello.' }]],
    },
  ];

  const dataJson = JSON.stringify(records);
  const preregJson = '{"schema_version":3}\n';
  const dataHash = digest(dataJson);
  const preregHash = digest(preregJson);

  // v1 auth for generation (backward compat)
  const auth = {
    schema_version: 1,
    authorized_by: 'test-custodian',
    authorized_at: new Date(Date.now() - 60000).toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    benchmark: 'longmemeval',
    dataset_variant: 'test',
    allowed_subset: 'test-only',
    dataset_sha256: dataHash,
    product_commit: PRODUCT_COMMIT,
    adapter_commit: ADAPTER_COMMIT,
    preregistration_sha256: preregHash,
    allow_formal_run: true,
  };

  const dataPath = path.join(dir, 'generation.json');
  const preregPath = path.join(dir, 'prereg.json');
  const authPath = path.join(dir, 'auth.json');
  const behaviorPath = path.join(dir, 'behavior.json');
  const outputRoot = path.join(dir, 'output');

  await writeFile(dataPath, dataJson);
  await writeFile(preregPath, preregJson);
  await writeFile(authPath, JSON.stringify(auth));

  // Behavior: q1 would return 'answer-q1' if called, q2 returns 'answer-q2'
  const behavior = {
    'Question for q1': [{ answer: 'answer-q1-re-run' }],
    'Question for q2': [{ answer: 'answer-q2' }],
  };
  await writeFile(behaviorPath, JSON.stringify(behavior));

  // Simulate crash: q1 result was written to results.jsonl, but checkpoint was NOT updated
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, 'results.jsonl'), JSON.stringify({ question_id: 'q1', hypothesis: 'previous-answer-q1', abstained: false, diagnostics: {} }) + '\n');
  // Checkpoint does NOT include q1 (crash happened before checkpoint save)
  await writeFile(path.join(outputRoot, 'checkpoint.json'), JSON.stringify({ schema_version: 2, benchmark: 'longmemeval', completed_ids: [], terminal_error_ids: [] }, null, 2) + '\n');

  const origEnv = { ...process.env };
  process.env.OMNI_HELDOUT_AUTHORIZATION_FILE = authPath;
  process.env.MOCK_ENGINE_BEHAVIOR_PATH = behaviorPath;
  t.after(() => { process.env = { ...origEnv }; });

  await runFormalGeneration({
    authorizationFile: authPath, adapterCommit: ADAPTER_COMMIT, preregistrationPath: preregPath,
    generationDataPath: dataPath, benchmark: 'longmemeval', datasetVariant: 'test', allowedSubset: 'test-only',
    accessLog: path.join(outputRoot, 'data-access.jsonl'), outputRoot, engineModule: MOCK_ENGINE_PATH,
  });

  const resultsContent = await readFile(path.join(outputRoot, 'results.jsonl'), 'utf8');
  const results = resultsContent.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);

  // q1 must appear exactly once (not re-run)
  const q1Results = results.filter((r) => r.question_id === 'q1');
  assert.equal(q1Results.length, 1, 'q1 must not be re-run after crash recovery');
  assert.equal(q1Results[0].hypothesis, 'previous-answer-q1', 'q1 result must be the original, not re-run');

  // q2 must be processed
  const q2Results = results.filter((r) => r.question_id === 'q2');
  assert.equal(q2Results.length, 1, 'q2 must be processed');
  assert.equal(q2Results[0].hypothesis, 'answer-q2');
});

// === Test 18: Temperature mixed aggregation ===
test('v4 integrity: temperature_control is mixed when some calls send temperature=0 and others fall back', async () => {
  const results = [
    makeResult('q1', 'Answer 1'),
    makeResult('q2', 'Answer 2'),
  ];
  const gold = [
    makeGold('q1', 'single-session-user', 'Q1?', 'Answer 1'),
    makeGold('q2', 'single-session-user', 'Q2?', 'Answer 2'),
  ];

  let q1Call = true;
  const callMoonshot = async ({ sendTemperature }) => {
    if (q1Call) {
      // q1: succeeds with temperature=0 sent
      q1Call = false;
      assert.ok(sendTemperature, 'first call must send temperature');
      return { content: '{"label":"yes"}', usage: { total_tokens: 10 } };
    }
    // q2: first attempt fails with temperature error, second attempt falls back
    if (sendTemperature) {
      throw new Error('MOONSHOT_API_ERROR:400:temperature parameter not supported');
    }
    return { content: '{"label":"yes"}', usage: { total_tokens: 10 } };
  };

  const metrics = await scoreWithDeps({ results, gold, deps: { callMoonshot, apiKey: 'test-key' } });
  assert.equal(metrics.temperature_zero_sent_calls, 1, 'q1 sent temperature=0');
  assert.equal(metrics.temperature_fallback_calls, 1, 'q2 fell back to provider default');
  assert.equal(metrics.temperature_control, 'mixed', 'mixed when combination of zero-sent and fallback');
  assert.equal(metrics.correct, 2);
});

// === Additional: Generation auth cannot be used for scoring ===
test('v4 integrity: generation-only auth rejected for scoring phase', () => {
  const auth = validAuthV2({ allow_formal_generation: true, allow_formal_scoring: false });
  assert.throws(
    () => validateAuthorizationV2(auth, {}, 'scoring'),
    /AUTHORIZATION_V2_SCORING_NOT_ALLOWED/,
  );
});

// === Additional: Scoring auth cannot be used for generation ===
test('v4 integrity: scoring-only auth rejected for generation phase', () => {
  const auth = validAuthV2({ allow_formal_generation: false, allow_formal_scoring: true });
  assert.throws(
    () => validateAuthorizationV2(auth, {}, 'generation'),
    /AUTHORIZATION_V2_GENERATION_NOT_ALLOWED/,
  );
});

// === Additional: rebuildStateFromResults detects duplicate terminal results ===
test('v4 integrity: rebuildStateFromResults rejects duplicate completed results', async (t) => {
  const dir = await tempDir(t);
  const resultPath = path.join(dir, 'results.jsonl');
  await writeFile(resultPath, JSON.stringify({ question_id: 'q1', hypothesis: 'A', abstained: false }) + '\n' + JSON.stringify({ question_id: 'q1', hypothesis: 'B', abstained: false }) + '\n');
  await assert.rejects(
    () => rebuildStateFromResults(resultPath),
    /DUPLICATE_COMPLETED_RESULT/,
  );
});

// === Additional: validateFormalLock enforces 500 count ===
test('v4 integrity: validateFormalLock rejects non-500 results', () => {
  const results = Array.from({ length: 499 }, (_, i) => makeResult(`q${i}`, 'A'));
  assert.throws(
    () => validateFormalLock(results, 500),
    /FORMAL_LOCK_UNIQUE_IDS_MISMATCH/,
  );
});

// === Additional: validateFormalLock rejects duplicates ===
test('v4 integrity: validateFormalLock rejects duplicate IDs', () => {
  const results = Array.from({ length: 500 }, (_, i) => makeResult(`q${i % 499}`, 'A'));
  assert.throws(
    () => validateFormalLock(results, 500),
    /FORMAL_LOCK_DUPLICATE_IDS/,
  );
});
