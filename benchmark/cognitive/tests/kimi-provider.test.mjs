import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { CognitiveProvider } from '../src/provider.mjs';

const rubric = () => ({
  rubric_scores: Object.fromEntries(['insight_precision', 'insight_recall', 'blind_spot_detection', 'constraint_awareness', 'actionability', 'goal_alignment', 'option_comparison', 'risk_awareness', 'internal_consistency', 'overall_quality'].map((key) => [key, 0.75])),
  unsupported_claim_rate: 0.25,
  overreach_rate: 0,
  redundant_insight_rate: 0.25,
  missing_required_elements: [],
  unsupported_elements: [],
  rationale: 'Structured calibration.',
});
const config = { max_retries: 0, retry_base_ms: 0, request_timeout_ms: 5000, primary_judge: { model: 'kimi-k2.6', temperature_control: 'provider_default_non_configurable', temperature_parameter_sent: false, max_completion_tokens: 600, call_limit: 40 }, answer: { model: 'deepseek-v4-flash', max_tokens: 100 }, secondary_review: { model: 'deepseek-v4-flash' } };
const scenario = { scenario_id: 'k1', category: 'proactive_insight', question: 'q', gold: {} };

test('Kimi uses JSON Schema first and normalizes cached-token usage', async () => {
  const tmp = await mkdtemp(path.join(process.cwd(), 'kimi-test-'));
  const originalFetch = global.fetch;
  const oldKey = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = 'unit-test-placeholder';
  try {
    let request;
    global.fetch = async (_url, options) => {
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ model: 'kimi-k2.6', choices: [{ message: { content: JSON.stringify(rubric()) } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cached_tokens: 40 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const ledger = path.join(tmp, 'usage.json');
    const provider = new CognitiveProvider({ config, answerPrompt: '', judgePrompt: 'judge', reviewPrompt: '', runRoot: tmp, brainServerRoot: tmp, kimiUsagePath: ledger });
    const result = await provider.judge({ scenario, answer: {}, context: [], phase: 'preflight' });
    assert.equal(request.model, 'kimi-k2.6');
    assert.equal(Object.hasOwn(request, 'temperature'), false);
    assert.equal(request.thinking.type, 'disabled');
    assert.equal(request.stream, false);
    assert.equal(request.max_completion_tokens, 600);
    assert.equal(request.response_format.type, 'json_schema');
    assert.equal(result.usage.cache_hit_input_tokens, 40);
    assert.equal(result.model, 'kimi-k2.6');
    const usage = JSON.parse(await readFile(ledger, 'utf8'));
    assert.equal(usage.calls, 1);
    assert.equal(usage.cached_tokens, 40);
    assert.equal(usage.attempts[0].status, 'completed');
    assert.equal(usage.attempts[0].phase, 'preflight');
    assert.equal(usage.attempts[0].temperature_parameter_sent, false);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.MOONSHOT_API_KEY; else process.env.MOONSHOT_API_KEY = oldKey;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Kimi records an explicit JSON-object fallback only after server rejection', async () => {
  const tmp = await mkdtemp(path.join(process.cwd(), 'kimi-test-'));
  const originalFetch = global.fetch;
  const oldKey = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = 'unit-test-placeholder';
  try {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls === 1) return new Response('response_format json_schema unsupported', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(rubric()) } }], usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const ledger = path.join(tmp, 'usage.json');
    const provider = new CognitiveProvider({ config, answerPrompt: '', judgePrompt: 'judge', reviewPrompt: '', runRoot: tmp, brainServerRoot: tmp, kimiUsagePath: ledger });
    const result = await provider.judge({ scenario, answer: {}, context: [] });
    assert.equal(result.structured_output_fallback, true);
    assert.match(result.fallback_reason, /unsupported/);
    const usage = JSON.parse(await readFile(ledger, 'utf8'));
    assert.equal(usage.calls, 2);
    assert.equal(usage.structured_output_fallbacks, 1);
    assert.equal(usage.attempts[0].status, 'response_format_unsupported');
    assert.equal(usage.attempts[1].status, 'completed');
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.MOONSHOT_API_KEY; else process.env.MOONSHOT_API_KEY = oldKey;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Kimi hard-stops before call 41', async () => {
  const tmp = await mkdtemp(path.join(process.cwd(), 'kimi-test-'));
  const oldKey = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = 'unit-test-placeholder';
  try {
    const ledger = path.join(tmp, 'usage.json');
    await writeFile(ledger, JSON.stringify({ calls: 40, call_limit: 40, attempts: [], consecutive_provider_errors: 0, consecutive_schema_failures: 0 }));
    const provider = new CognitiveProvider({ config, answerPrompt: '', judgePrompt: 'judge', reviewPrompt: '', runRoot: tmp, brainServerRoot: tmp, kimiUsagePath: ledger });
    await assert.rejects(() => provider.judge({ scenario, answer: {}, context: [] }), /KIMI_CALL_LIMIT_REACHED/);
  } finally {
    if (oldKey === undefined) delete process.env.MOONSHOT_API_KEY; else process.env.MOONSHOT_API_KEY = oldKey;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Kimi counts malformed JSON as schema failures and stops after three', async () => {
  const tmp = await mkdtemp(path.join(process.cwd(), 'kimi-test-'));
  const originalFetch = global.fetch;
  const oldKey = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = 'unit-test-placeholder';
  try {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{not-json' } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const ledger = path.join(tmp, 'usage.json');
    const provider = new CognitiveProvider({ config: { ...config, max_retries: 2 }, answerPrompt: '', judgePrompt: 'judge', reviewPrompt: '', runRoot: tmp, brainServerRoot: tmp, kimiUsagePath: ledger });
    await assert.rejects(() => provider.judge({ scenario, answer: {}, context: [] }), /JSON/);
    const usage = JSON.parse(await readFile(ledger, 'utf8'));
    assert.equal(calls, 3);
    assert.equal(usage.schema_failures, 3);
    assert.equal(usage.errors, 0);
    await assert.rejects(() => provider.judge({ scenario, answer: {}, context: [] }), /three consecutive schema failures/);
    assert.equal(calls, 3);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.MOONSHOT_API_KEY; else process.env.MOONSHOT_API_KEY = oldKey;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Kimi omits temperature and does not retry a provider-declared temperature constraint', async () => {
  const tmp = await mkdtemp(path.join(process.cwd(), 'kimi-test-'));
  const originalFetch = global.fetch;
  const oldKey = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = 'unit-test-placeholder';
  try {
    let calls = 0;
    let request;
    global.fetch = async (_url, options) => {
      calls++;
      request = JSON.parse(options.body);
      return new Response(JSON.stringify({ error: { message: 'invalid temperature: only 0.6 is allowed for this model', type: 'invalid_request_error' } }), { status: 400 });
    };
    const ledger = path.join(tmp, 'usage.json');
    const provider = new CognitiveProvider({ config: { ...config, max_retries: 2 }, answerPrompt: '', judgePrompt: 'judge', reviewPrompt: '', runRoot: tmp, brainServerRoot: tmp, kimiUsagePath: ledger });
    await assert.rejects(() => provider.judge({ scenario, answer: {}, context: [] }), /invalid temperature/);
    assert.equal(calls, 1);
    assert.equal(Object.hasOwn(request, 'temperature'), false);
    const usage = JSON.parse(await readFile(ledger, 'utf8'));
    assert.equal(usage.calls, 1);
    assert.equal(usage.errors, 1);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.MOONSHOT_API_KEY; else process.env.MOONSHOT_API_KEY = oldKey;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Kimi stops safely after three consecutive generic provider errors', async () => {
  const tmp = await mkdtemp(path.join(process.cwd(), 'kimi-test-'));
  const originalFetch = global.fetch;
  const oldKey = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = 'unit-test-placeholder';
  try {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return new Response('temporary upstream failure', { status: 503 });
    };
    const ledger = path.join(tmp, 'usage.json');
    const provider = new CognitiveProvider({ config: { ...config, max_retries: 2 }, answerPrompt: '', judgePrompt: 'judge', reviewPrompt: '', runRoot: tmp, brainServerRoot: tmp, kimiUsagePath: ledger });
    await assert.rejects(() => provider.judge({ scenario, answer: {}, context: [] }), /Kimi 503/);
    assert.equal(calls, 3);
    const usage = JSON.parse(await readFile(ledger, 'utf8'));
    assert.equal(usage.errors, 3);
    assert.equal(usage.consecutive_provider_errors, 3);
    await assert.rejects(() => provider.judge({ scenario, answer: {}, context: [] }), /three consecutive provider errors/);
    assert.equal(calls, 3);
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.MOONSHOT_API_KEY; else process.env.MOONSHOT_API_KEY = oldKey;
    await rm(tmp, { recursive: true, force: true });
  }
});
