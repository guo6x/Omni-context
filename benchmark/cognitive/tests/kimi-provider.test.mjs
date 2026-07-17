import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { CognitiveProvider, normalizeAnswerV2Shape, parseStructuredJudgeResponse } from '../src/provider.mjs';

const rubric = () => ({
  rubric_scores: Object.fromEntries(['insight_precision', 'insight_recall', 'blind_spot_detection', 'constraint_awareness', 'actionability', 'goal_alignment', 'option_comparison', 'risk_awareness', 'internal_consistency', 'overall_quality'].map((key) => [key, 0.75])),
  unsupported_claim_rate: 0.25,
  overreach_rate: 0,
  redundant_insight_rate: 0.25,
  missing_required_elements: [],
  unsupported_elements: [],
  rationale: 'Structured calibration.',
});
const config = { max_retries: 2, retry_base_ms: 0, request_timeout_ms: 5000, primary_judge: { model: 'kimi-k2.6', temperature_control: 'provider_default_non_configurable', temperature_parameter_sent: false, max_completion_tokens: 1200, call_limit: 60, adapter_version: 'kimi-judge-adapter-v2.1', rubric_version: 'kimi-judge-rubric-v2' }, answer: { model: 'deepseek-v4-flash', max_tokens: 100 }, secondary_review: { model: 'deepseek-v4-flash' } };
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
      return new Response(JSON.stringify({ model: 'kimi-k2.6', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(rubric()) } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cached_tokens: 40 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const ledger = path.join(tmp, 'usage.json');
    const provider = new CognitiveProvider({ config, answerPrompt: '', judgePrompt: 'judge', reviewPrompt: '', runRoot: tmp, brainServerRoot: tmp, kimiUsagePath: ledger });
    const result = await provider.judge({ scenario, answer: {}, context: [], phase: 'preflight' });
    assert.equal(request.model, 'kimi-k2.6');
    assert.equal(Object.hasOwn(request, 'temperature'), false);
    assert.equal(request.thinking.type, 'disabled');
    assert.equal(request.stream, false);
    assert.equal(request.max_completion_tokens, 1200);
    assert.equal(request.response_format.type, 'json_schema');
    assert.equal(result.usage.cache_hit_input_tokens, 40);
    assert.equal(result.model, 'kimi-k2.6');
    const usage = JSON.parse(await readFile(ledger, 'utf8'));
    assert.equal(usage.calls, 1);
    assert.equal(usage.physical_attempts, 1);
    assert.equal(usage.logical_judge_calls, 1);
    assert.equal(usage.successful_logical_calls, 1);
    assert.equal(usage.cached_tokens, 40);
    assert.equal(usage.attempts[0].status, 'completed');
    assert.equal(usage.attempts[0].phase, 'preflight');
    assert.equal(usage.attempts[0].temperature_parameter_sent, false);
    assert.equal(usage.attempts[0].finish_reason, 'stop');
    assert.equal(usage.attempts[0].completion_tokens, 20);
    assert.ok(usage.attempts[0].raw_character_count > 0);
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

test('Kimi hard-stops before physical attempt 61', async () => {
  const tmp = await mkdtemp(path.join(process.cwd(), 'kimi-test-'));
  const oldKey = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = 'unit-test-placeholder';
  try {
    const ledger = path.join(tmp, 'usage.json');
    await writeFile(ledger, JSON.stringify({ calls: 60, physical_attempts: 60, call_limit: 60, attempts: [], logical_calls: [], consecutive_provider_errors: 0, consecutive_schema_failures: 0 }));
    const provider = new CognitiveProvider({ config, answerPrompt: '', judgePrompt: 'judge', reviewPrompt: '', runRoot: tmp, brainServerRoot: tmp, kimiUsagePath: ledger });
    await assert.rejects(() => provider.judge({ scenario, answer: {}, context: [] }), /KIMI_CALL_LIMIT_REACHED/);
  } finally {
    if (oldKey === undefined) delete process.env.MOONSHOT_API_KEY; else process.env.MOONSHOT_API_KEY = oldKey;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Kimi separates one logical call from three malformed physical attempts', async () => {
  const tmp = await mkdtemp(path.join(process.cwd(), 'kimi-test-'));
  const originalFetch = global.fetch;
  const oldKey = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = 'unit-test-placeholder';
  try {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{not-json' } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const ledger = path.join(tmp, 'usage.json');
    const provider = new CognitiveProvider({ config: { ...config, max_retries: 2 }, answerPrompt: '', judgePrompt: 'judge', reviewPrompt: '', runRoot: tmp, brainServerRoot: tmp, kimiUsagePath: ledger });
    await assert.rejects(() => provider.judge({ scenario, answer: {}, context: [] }), /JSON/);
    const usage = JSON.parse(await readFile(ledger, 'utf8'));
    assert.equal(calls, 3);
    assert.equal(usage.logical_judge_calls, 1);
    assert.equal(usage.physical_attempts, 3);
    assert.equal(usage.malformed_attempts, 3);
    assert.equal(usage.schema_failures, 3);
    assert.equal(usage.errors, 0);
    assert.equal(usage.successful_logical_calls, 0);
    assert.equal(usage.logical_calls[0].status, 'error');
    assert.equal(usage.attempts[0].raw_summary.raw_character_count, 9);
    assert.equal(usage.attempts[0].raw_summary.first_200, '{not-json');
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.MOONSHOT_API_KEY; else process.env.MOONSHOT_API_KEY = oldKey;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Kimi classifies finish_reason length as output_truncated and recovers on retry', async () => {
  const tmp = await mkdtemp(path.join(process.cwd(), 'kimi-test-'));
  const originalFetch = global.fetch;
  const oldKey = process.env.MOONSHOT_API_KEY;
  process.env.MOONSHOT_API_KEY = 'unit-test-placeholder';
  try {
    const requests = [];
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      const truncated = requests.length === 1;
      return new Response(JSON.stringify({ choices: [{ finish_reason: truncated ? 'length' : 'stop', message: { content: truncated ? '{"rubric_scores":' : JSON.stringify(rubric()) } }], usage: { prompt_tokens: 10, completion_tokens: truncated ? 1200 : 40, total_tokens: truncated ? 1210 : 50 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const ledger = path.join(tmp, 'usage.json');
    const provider = new CognitiveProvider({ config, answerPrompt: '', judgePrompt: 'judge', reviewPrompt: '', runRoot: tmp, brainServerRoot: tmp, kimiUsagePath: ledger });
    const result = await provider.judge({ scenario, answer: {}, context: [] });
    assert.equal(result.physical_attempts, 2);
    assert.equal(result.retries_recovered, true);
    assert.match(requests[1].messages[0].content, /previous response was invalid or truncated/);
    const usage = JSON.parse(await readFile(ledger, 'utf8'));
    assert.equal(usage.truncated_attempts, 1);
    assert.equal(usage.retries_recovered, 1);
    assert.equal(usage.attempts[0].failure_type, 'output_truncated');
  } finally {
    global.fetch = originalFetch;
    if (oldKey === undefined) delete process.env.MOONSHOT_API_KEY; else process.env.MOONSHOT_API_KEY = oldKey;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('parseStructuredJudgeResponse accepts direct, fenced, and surrounded complete JSON only', () => {
  const value = rubric();
  assert.deepEqual(parseStructuredJudgeResponse(JSON.stringify(value)), value);
  assert.deepEqual(parseStructuredJudgeResponse(`preface\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\nafter`), value);
  assert.deepEqual(parseStructuredJudgeResponse(`Explanation before ${JSON.stringify(value)} after`), value);
  assert.throws(() => parseStructuredJudgeResponse('{"rubric_scores":'), /complete JSON object/);
});

test('DeepSeek Answer retries schema validation with a compact corrective instruction', async () => {
  const tmp = await mkdtemp(path.join(process.cwd(), 'answer-test-'));
  const originalFetch = global.fetch;
  const oldUrl = process.env.LLM_API_URL;
  const oldKey = process.env.LLM_API_KEY;
  process.env.LLM_API_URL = 'https://unit-test.invalid/v1';
  process.env.LLM_API_KEY = 'unit-test-placeholder';
  try {
    const requests = [];
    const valid = { answer: 'Supported.', facts: [{ key: 'k', value: 'v', state: 'supported', source_ids: ['s1'], source_agents: ['Agent-A'] }], transitions: [], constraints_used: [], rejected_facts: [], insights: [], actions: [], uncertainty: null };
    global.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      const structured = requests.length === 1 ? { ...valid, extra: true } : valid;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(structured) } }], usage: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const provider = new CognitiveProvider({ config, answerPrompt: 'base prompt', judgePrompt: 'judge', reviewPrompt: '', runRoot: tmp, brainServerRoot: tmp, kimiUsagePath: path.join(tmp, 'usage.json') });
    const result = await provider.answer({ scenario: { question: 'q' }, mode: 'retrieval_only', context: [{ source_id: 's1', source_agents: ['Agent-A'] }] });
    assert.equal(result.schema_validation_attempts, 2);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].messages[0].content, 'base prompt');
    assert.match(requests[1].messages[0].content, /failed answer-schema-v2 validation/);
  } finally {
    global.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.LLM_API_URL; else process.env.LLM_API_URL = oldUrl;
    if (oldKey === undefined) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = oldKey;
    await rm(tmp, { recursive: true, force: true });
  }
});

test('Answer shape normalization removes only redundant rejected_fact source_agents', () => {
  const source = { answer: 'a', rejected_facts: [{ value: 'v', reason: 'noise', source_ids: ['s1'], source_agents: ['Agent-A'] }] };
  const normalized = normalizeAnswerV2Shape(source);
  assert.deepEqual(normalized.value.rejected_facts[0], { value: 'v', reason: 'noise', source_ids: ['s1'] });
  assert.equal(normalized.normalizations.length, 1);
  const unsafe = normalizeAnswerV2Shape({ rejected_facts: [{ value: 'v', reason: 'noise', source_ids: ['s1'], invented: true }] });
  assert.equal(unsafe.value.rejected_facts[0].invented, true);
  assert.equal(unsafe.normalizations.length, 0);
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
