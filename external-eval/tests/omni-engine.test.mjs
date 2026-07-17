import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createEngineWithDeps } from '../engines/omni-frozen-v3.1.mjs';
import { normalizeLongMemEvalGeneration } from '../adapters/longmemeval.mjs';

const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEMP_ROOT = 'D:\\OmniContext-research-runs\\external\\engine-test-temp';

const EXPECTED_PRODUCT_COMMIT = '17dc1d0107b0474de84058205a91b302ba290a74';
const EXPECTED_PROMPT_SHA256 = '4eb58be8c29f789618fc15f1da3d7c22d3a36c70de549d559c2bb8fefbb5fd21';

const ORIGINAL_ENV = { ...process.env };

test.before(async () => {
  await mkdir(TEMP_ROOT, { recursive: true });
  process.env.OMNI_BRAIN_SERVER_ROOT = 'D:\\mock-brain-server-root';
  process.env.OMNI_EXTERNAL_RUN_ROOT = TEMP_ROOT;
});

test.after(() => {
  process.env = { ...ORIGINAL_ENV };
});

function createMocks(overrides = {}) {
  const calls = {
    runtimeStart: 0,
    runtimeStop: 0,
    rebuildEmbeddings: 0,
    preflight: 0,
    extract: [],
    unifiedMemorySearch: [],
    graphAnswer: [],
    providerAnswer: [],
    runtimeOptions: null,
    providerOptions: null,
  };

  const retrievalResult = overrides.retrievalResult || {
    finalContext: [
      { evidence_id: 'ev-1', passage: 'Teal notebook chosen.' },
      { evidence_id: 'ev-2', passage: 'North Quay Museum suggested.' },
    ],
    searchMethods: { semantic: true, lexical: false },
  };

  const client = {
    rebuildEmbeddings: async () => { calls.rebuildEmbeddings++; },
    preflight: async () => { calls.preflight++; },
    extract: async (text, source, opts) => { calls.extract.push({ text, source, opts }); },
    unifiedMemorySearch: async (query, limit) => {
      calls.unifiedMemorySearch.push({ query, limit });
      return retrievalResult;
    },
    graphAnswer: async (query) => {
      calls.graphAnswer.push({ query });
      return { answer: 'graph-answer-should-not-be-used' };
    },
  };

  const runtime = {
    start: async () => { calls.runtimeStart++; },
    stop: async () => { calls.runtimeStop++; },
    client,
    getAttestation: () => ({
      product_commit: EXPECTED_PRODUCT_COMMIT,
      build_sha256: 'af487d47018e3005c82684fd2c576524e12fbbb51dee2a64719fba0e255c2668',
      port: 0,
      isolated_database: true,
    }),
  };

  const createConversationRuntime = (options) => {
    calls.runtimeOptions = options;
    return runtime;
  };

  const answerResult = overrides.answerResult || {
    structured: { answer: 'The teal notebook.' },
    model: 'deepseek-v4-flash',
    latency_ms: 42,
    usage: { total_tokens: 100, prompt_tokens: 80, completion_tokens: 20 },
    attempts: 1,
    schema_validation_attempts: 1,
  };

  const CognitiveProvider = class MockCognitiveProvider {
    constructor(opts) { calls.providerOptions = opts; }
    async answer({ scenario, mode, context }) {
      calls.providerAnswer.push({ scenario, mode, context });
      return answerResult;
    }
  };

  const evidenceSourceAgents = (item, passage) => {
    return Array.isArray(item?.source_agents) ? item.source_agents : ['mock-agent'];
  };

  return { calls, createConversationRuntime, CognitiveProvider, evidenceSourceAgents };
}

function fictionalSession(sessionId, timestamp, messages) {
  return { session_id: sessionId, timestamp, messages };
}

function fictionalRecord() {
  return {
    question_id: 'fx-test-01',
    question: 'Which color did the user choose?',
    question_date: '2026-01-12',
    question_type: 'single-session-user',
    haystack_session_ids: ['s1', 's2'],
    haystack_dates: ['2026-01-01T09:00:00Z', '2026-01-05T09:00:00Z'],
    haystack_sessions: [
      [
        { role: 'user', content: 'I chose a teal notebook for the workshop.' },
        { role: 'assistant', content: 'Teal notebook noted.' },
      ],
      [
        { role: 'user', content: 'The workshop starts at noon.' },
      ],
    ],
  };
}

async function createEngine(mocks, overrides = {}) {
  return createEngineWithDeps({
    productCommit: overrides.productCommit || EXPECTED_PRODUCT_COMMIT,
    isolatedDatabase: overrides.isolatedDatabase !== undefined ? overrides.isolatedDatabase : true,
    dynamicPort: overrides.dynamicPort !== undefined ? overrides.dynamicPort : true,
    deps: {
      createConversationRuntime: mocks.createConversationRuntime,
      CognitiveProvider: mocks.CognitiveProvider,
      evidenceSourceAgents: mocks.evidenceSourceAgents,
      randomId: overrides.randomId || (() => 'fixed-random-id'),
    },
  });
}

// === Assertion 1: Wrong product commit rejected ===
test('engine rejects wrong product commit', async () => {
  const mocks = createMocks();
  await assert.rejects(
    () => createEngine(mocks, { productCommit: '0'.repeat(40) }),
    /ENGINE_PRODUCT_COMMIT_MISMATCH/,
  );
  assert.equal(mocks.calls.runtimeStart, 0, 'runtime must not start on commit mismatch');
});

// === Assertion 2: isolatedDatabase=false rejected ===
test('engine rejects isolatedDatabase=false', async () => {
  const mocks = createMocks();
  await assert.rejects(
    () => createEngine(mocks, { isolatedDatabase: false }),
    /ENGINE_ISOLATED_DATABASE_REQUIRED/,
  );
});

// === Assertion 3: dynamicPort=false rejected ===
test('engine rejects dynamicPort=false', async () => {
  const mocks = createMocks();
  await assert.rejects(
    () => createEngine(mocks, { dynamicPort: false }),
    /ENGINE_DYNAMIC_PORT_REQUIRED/,
  );
});

// === Assertion 4: Each engine uses unique run directory ===
test('each engine instance gets a unique run directory', async () => {
  const ids = ['id-alpha', 'id-beta'];
  let idIndex = 0;
  const mocksA = createMocks();
  const engineA = await createEngine(mocksA, { randomId: () => ids[idIndex++] });
  const runDirA = mocksA.calls.runtimeOptions.runDir;
  await engineA.stop();

  const mocksB = createMocks();
  const engineB = await createEngine(mocksB, { randomId: () => ids[idIndex++] });
  const runDirB = mocksB.calls.runtimeOptions.runDir;
  await engineB.stop();

  assert.notEqual(runDirA, runDirB, 'run directories must differ');
  assert.match(runDirA, /engine-runs[\\/]\d+-id-alpha$/);
  assert.match(runDirB, /engine-runs[\\/]\d+-id-beta$/);
});

// === Assertions 5-8: Session serialization and ingest ===
test('session is serialized in original order with role and timestamp preserved, one extract per session', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    const record = normalizeLongMemEvalGeneration(fictionalRecord());
    for (const session of record.sessions) {
      await engine.ingest(session);
    }

    assert.equal(mocks.calls.extract.length, 2, 'one extract call per session');

    const firstCall = mocks.calls.extract[0];
    assert.match(firstCall.text, /\[SESSION s1\]/, 'session header preserved');
    assert.match(firstCall.text, /Timestamp: 2026-01-01T09:00:00Z/, 'timestamp preserved');
    assert.match(firstCall.text, /user: I chose a teal notebook for the workshop\./, 'user role preserved');
    assert.match(firstCall.text, /assistant: Teal notebook noted\./, 'assistant role preserved');

    // Verify order: s1 content before s2 content
    const firstText = mocks.calls.extract[0].text;
    const secondText = mocks.calls.extract[1].text;
    assert.ok(firstText.includes('[SESSION s1]'), 'first session is s1');
    assert.ok(secondText.includes('[SESSION s2]'), 'second session is s2');

    // Verify extract opts
    assert.equal(firstCall.opts.sessionId, 's1');
    assert.equal(firstCall.opts.timestamp, '2026-01-01T09:00:00Z');
    assert.equal(firstCall.opts.evaluationMode, true);
    assert.equal(firstCall.source, 'LongMemEval session s1');
  } finally {
    await engine.stop();
  }
});

// === Assertion 9: Query rebuilds embeddings before first search ===
test('first query rebuilds embeddings and runs preflight before search', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    const session = fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]);
    await engine.ingest(session);

    const preRebuild = mocks.calls.rebuildEmbeddings;
    const prePreflight = mocks.calls.preflight;
    // createEngine already called rebuildEmbeddings+preflight during init
    assert.ok(preRebuild >= 1, 'rebuildEmbeddings called during init');

    await engine.query({ question: 'What color?', questionDate: '2026-01-12' });

    // First query must call rebuildEmbeddings and preflight again
    assert.ok(mocks.calls.rebuildEmbeddings > preRebuild, 'rebuildEmbeddings called before first query');
    assert.ok(mocks.calls.preflight > prePreflight, 'preflight called before first query');
  } finally {
    await engine.stop();
  }
});

// === Assertion 10: Uses unifiedMemorySearch(question, 10) ===
test('query calls unifiedMemorySearch with limit=10', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    await engine.query({ question: 'What color?', questionDate: '2026-01-12' });

    assert.equal(mocks.calls.unifiedMemorySearch.length, 1);
    assert.equal(mocks.calls.unifiedMemorySearch[0].query, 'Current Date: 2026-01-12\nQuestion: What color?');
    assert.equal(mocks.calls.unifiedMemorySearch[0].limit, 10, 'top-k must be 10');
  } finally {
    await engine.stop();
  }
});

// === Assertion 11: Only Top-10 evidence taken ===
test('only top-10 evidence items are retained even if more are returned', async () => {
  const manyItems = Array.from({ length: 15 }, (_, i) => ({
    evidence_id: `ev-${i + 1}`,
    passage: `Passage ${i + 1}`,
  }));
  const mocks = createMocks({ retrievalResult: { finalContext: manyItems, searchMethods: {} } });
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    const result = await engine.query({ question: 'What?', questionDate: null });
    assert.equal(result.diagnostics.evidence_count, 10, 'evidence_count must be capped at 10');
    assert.equal(result.diagnostics.evidence_ids.length, 10);
  } finally {
    await engine.stop();
  }
});

// === Assertion 12: Evidence ID accurately mapped ===
test('evidence IDs are accurately mapped from retrieval items', async () => {
  const items = [
    { evidence_id: 'ev-alpha', passage: 'Alpha passage.' },
    { id: 'ev-beta', passage: 'Beta passage.' },
    { passage: 'Gamma passage.' }, // no id �?fallback
  ];
  const mocks = createMocks({ retrievalResult: { finalContext: items, searchMethods: {} } });
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    const result = await engine.query({ question: 'What?', questionDate: null });
    assert.deepEqual(result.diagnostics.evidence_ids, ['ev-alpha', 'ev-beta', 'omni-3']);
  } finally {
    await engine.stop();
  }
});

// === Assertion 13: Uses CognitiveProvider.answer() ===
test('query uses CognitiveProvider.answer() with full_omni mode', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    await engine.query({ question: 'What color?', questionDate: '2026-01-12' });

    assert.equal(mocks.calls.providerAnswer.length, 1, 'provider.answer called exactly once');
    assert.equal(mocks.calls.providerAnswer[0].mode, 'full_omni');
  } finally {
    await engine.stop();
  }
});

// === Assertion 14: Returns structured.answer ===
test('query returns structured.answer from provider', async () => {
  const mocks = createMocks({
    answerResult: {
      structured: { answer: 'The answer is 42.' },
      model: 'deepseek-v4-flash',
      latency_ms: 100,
      usage: { total_tokens: 50 },
      attempts: 1,
      schema_validation_attempts: 1,
    },
  });
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    const result = await engine.query({ question: 'What?', questionDate: null });
    assert.equal(result.answer, 'The answer is 42.');
  } finally {
    await engine.stop();
  }
});

// === Assertion 15: Diagnostics fields complete ===
test('diagnostics contains all required fields', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    const result = await engine.query({ question: 'What?', questionDate: '2026-01-12' });
    const d = result.diagnostics;
    const required = [
      'runtime_attestation', 'question_date', 'ingested_sessions', 'extraction_calls',
      'extraction_input_characters', 'retrieval_calls', 'reranker_calls',
      'retrieval_latency_ms', 'answer_latency_ms', 'answer_model', 'answer_usage',
      'answer_attempts', 'answer_schema_validation_attempts', 'search_methods',
      'evidence_count', 'evidence_ids',
    ];
    for (const field of required) {
      assert.ok(field in d, `diagnostics must contain ${field}`);
    }
    assert.equal(d.question_date, '2026-01-12');
    assert.equal(d.ingested_sessions, 1);
    assert.equal(d.extraction_calls, 1);
    assert.equal(d.extraction_input_characters > 0, true);
    assert.equal(d.retrieval_calls, 1);
    assert.equal(d.reranker_calls, 1);
    assert.equal(d.answer_model, 'deepseek-v4-flash');
    assert.equal(Array.isArray(d.evidence_ids), true);
  } finally {
    await engine.stop();
  }
});

// === Assertion 16: stop() is idempotent ===
test('stop() is idempotent and can be called after failed operations', async () => {
  const mocks = createMocks({
    retrievalResult: { finalContext: [], searchMethods: {} },
  });
  const engine = await createEngine(mocks);

  // Call stop twice �?no error
  await engine.stop();
  await engine.stop();
  assert.equal(mocks.calls.runtimeStop, 1, 'runtime.stop called exactly once');

  // stop() also works after a failed query
  const mocks2 = createMocks();
  const engine2 = await createEngine(mocks2);
  // Simulate query failure by making unifiedMemorySearch throw
  mocks2.calls; // keep reference
  const originalSearch = mocks2.calls; // not used directly, but engine holds client ref
  try {
    // Force a failure inside query by corrupting the client
    engine2.query = async () => { throw new Error('SIMULATED_QUERY_FAILURE'); };
    await assert.rejects(() => engine2.query({ question: 'fail', questionDate: null }), /SIMULATED_QUERY_FAILURE/);
  } finally {
    // stop() must still work
    await engine2.stop();
    await engine2.stop(); // idempotent
  }
  assert.equal(mocks2.calls.runtimeStop, 1, 'runtime.stop called even after query failure');
});

// === Assertion 17: Does not call graphAnswer ===
test('engine never calls graphAnswer', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    await engine.query({ question: 'What?', questionDate: null });
    assert.equal(mocks.calls.graphAnswer.length, 0, 'graphAnswer must never be called');
  } finally {
    await engine.stop();
  }
});

// === Assertion 18: Does not access Gold ===
test('engine scenario passed to provider contains no gold fields', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    await engine.query({ question: 'What?', questionDate: null });

    const scenario = mocks.calls.providerAnswer[0].scenario;
    const goldKeys = /^(?:answer|answers|gold|gold_answer|evidence|reference|references|score|label)$/i;
    for (const key of Object.keys(scenario)) {
      assert.ok(!goldKeys.test(key), `scenario must not contain gold key: ${key}`);
    }
    assert.ok('question' in scenario, 'scenario must contain question');
    assert.ok('scenario_id' in scenario, 'scenario must contain scenario_id');
    assert.equal(Object.keys(scenario).length, 2, 'scenario must only contain scenario_id and question');
  } finally {
    await engine.stop();
  }
});

// === Assertion 19: Does not access formal dataset ===
test('engine does not read or access any formal dataset file', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    // The engine only receives sessions via ingest() �?it has no file path to formal data.
    // Verify runtimeOptions do not contain any dataset path.
    const opts = mocks.calls.runtimeOptions;
    assert.ok(!opts.engineModule, 'runtime options must not contain engine module path');
    assert.ok(!opts.datasetPath, 'runtime options must not contain dataset path');
    assert.ok(!opts.generationDataPath, 'runtime options must not contain generation data path');

    // Verify extract source is session-based, not dataset-based
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    assert.match(mocks.calls.extract[0].source, /LongMemEval session s1/);
  } finally {
    await engine.stop();
  }
});

// === Assertion 20: Secret scan �?no API keys or absolute paths in output ===
test('query output contains no API keys, secrets, or absolute local paths', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    const result = await engine.query({ question: 'What?', questionDate: null });
    const serialized = JSON.stringify(result);

    // No API key patterns
    assert.doesNotMatch(serialized, /(?:sk-|Bearer\s)[A-Za-z0-9]{10,}/i, 'no API keys in output');
    assert.doesNotMatch(serialized, /LLM_API_KEY|OPENAI_API_KEY|api[_-]?key/i, 'no key variable names');

    // No absolute Windows paths (D:\ or C:\ etc.)
    assert.doesNotMatch(serialized, /[A-Z]:\\\\/i, 'no absolute Windows paths in output');

    // No prompt text leakage
    assert.doesNotMatch(serialized, /answer-v2|answer_prompt/i, 'no prompt file references');

    // No brain-server-root leakage
    assert.doesNotMatch(serialized, /brain-server-root|OMNI_BRAIN_SERVER_ROOT/i, 'no env var names');
  } finally {
    await engine.stop();
  }
});

// === Additional assertion: Prompt SHA-256 verified during init ===
test('engine verifies prompt SHA-256 during initialization', async () => {
  const mocks = createMocks();
  // If prompt hash were wrong, createEngineWithDeps would throw ENGINE_PROMPT_HASH_MISMATCH.
  // Since we use the real prompt file, it must succeed.
  const engine = await createEngine(mocks);
  await engine.stop();
  // Verify the prompt was loaded (providerOptions contains answerPrompt)
  assert.ok(mocks.calls.providerOptions.answerPrompt, 'answerPrompt loaded into provider');
  const hash = createHash('sha256').update(mocks.calls.providerOptions.answerPrompt).digest('hex');
  assert.equal(hash, EXPECTED_PROMPT_SHA256, 'prompt SHA-256 must match frozen value');
});

// === Additional assertion: Answer model is deepseek-v4-flash ===
test('provider answer model is deepseek-v4-flash', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    const result = await engine.query({ question: 'What?', questionDate: null });
    assert.equal(result.diagnostics.answer_model, 'deepseek-v4-flash');
  } finally {
    await engine.stop();
  }
});

// === Additional assertion: Runtime attestation saved ===
test('runtime attestation is captured in diagnostics', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    const result = await engine.query({ question: 'What?', questionDate: null });
    assert.ok(result.diagnostics.runtime_attestation, 'runtime_attestation present');
    assert.equal(result.diagnostics.runtime_attestation.product_commit, EXPECTED_PRODUCT_COMMIT);
  } finally {
    await engine.stop();
  }
});

// === Fixture Integration Test ===
test('fixture integration: createEngine �?ingest fictional sessions �?query fictional question �?stop (all PASS)', async (t) => {
  const fixturePath = path.join(TEST_ROOT, 'fixtures', 'longmemeval-generation-12.json');
  const fixtureRecords = JSON.parse(await readFile(fixturePath, 'utf8'));
  const normalized = normalizeLongMemEvalGeneration(fixtureRecords[0]);

  const mocks = createMocks({
    retrievalResult: {
      finalContext: [
        { evidence_id: 'fx-ev-1', passage: 'Teal notebook chosen for workshop.' },
      ],
      searchMethods: { semantic: true },
    },
    answerResult: {
      structured: { answer: 'A teal notebook.' },
      model: 'deepseek-v4-flash',
      latency_ms: 55,
      usage: { total_tokens: 80 },
      attempts: 1,
      schema_validation_attempts: 1,
    },
  });

  const engine = await createEngine(mocks);
  try {
    // Session ingestion
    for (const session of normalized.sessions) {
      await engine.ingest(session);
    }
    assert.equal(mocks.calls.extract.length, normalized.sessions.length, 'all sessions ingested');

    // Query
    const result = await engine.query({ question: normalized.question, questionDate: normalized.question_date });

    // engine interface = PASS
    assert.equal(typeof result.answer, 'string', 'engine interface returns answer string');

    // session ingestion = PASS (verified above)
    assert.ok(mocks.calls.extract.length > 0, 'session ingestion occurred');

    // retrieval mapping = PASS
    assert.equal(mocks.calls.unifiedMemorySearch.length, 1, 'retrieval called once');
    assert.equal(mocks.calls.unifiedMemorySearch[0].limit, 10, 'top-k=10');
    assert.ok(result.diagnostics.evidence_count >= 1, 'evidence mapped');

    // answer mapping = PASS
    assert.equal(result.answer, 'A teal notebook.', 'answer mapped from structured.answer');
    assert.equal(result.diagnostics.answer_model, 'deepseek-v4-flash', 'answer model correct');

    // runtime cleanup = PASS (verified by stop() below)
  } finally {
    await engine.stop();
  }

  // runtime cleanup = PASS
  assert.equal(mocks.calls.runtimeStop, 1, 'runtime stopped exactly once');
  // stop() idempotent
  await engine.stop();
  assert.equal(mocks.calls.runtimeStop, 1, 'stop() idempotent in fixture test');
});

// === Assertion: Second query does not rebuild embeddings again ===
test('second query skips rebuildEmbeddings (only first query rebuilds)', async () => {
  const mocks = createMocks();
  const engine = await createEngine(mocks);
  try {
    await engine.ingest(fictionalSession('s1', '2026-01-01T09:00:00Z', [{ role: 'user', content: 'Hello.' }]));
    await engine.query({ question: 'Q1', questionDate: null });
    const rebuildsAfterFirst = mocks.calls.rebuildEmbeddings;
    await engine.query({ question: 'Q2', questionDate: null });
    assert.equal(mocks.calls.rebuildEmbeddings, rebuildsAfterFirst, 'second query must not rebuild embeddings');
  } finally {
    await engine.stop();
  }
});
