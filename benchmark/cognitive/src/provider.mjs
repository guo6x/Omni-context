import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createConversationRuntime } from '../../src/conversation-runtime.mjs';
import { KIMI_JUDGE_SCHEMA_V2, validateAnswerV2, validateKimiJudgeV2 } from './schemas.mjs';

function cleanJson(text) {
  return JSON.parse(String(text).replace(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g, '$1').trim());
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label} keys do not match schema`);
}

export function validateAgentReview(value) {
  exactKeys(value, ['scenario_id', 'verdict', 'score_issue', 'gold_ambiguity', 'baseline_fairness_issue', 'memory_leakage_issue', 'notes'], 'agent review');
  if (typeof value.scenario_id !== 'string' || !['agree', 'flag'].includes(value.verdict) || typeof value.notes !== 'string') throw new Error('agent review identity/verdict invalid');
  for (const key of ['score_issue', 'gold_ambiguity', 'baseline_fairness_issue', 'memory_leakage_issue']) if (typeof value[key] !== 'boolean') throw new Error(`${key} must be boolean`);
  return value;
}

export function evidenceSourceAgents(item, passage) {
  const direct = [
    ...(Array.isArray(item?.source_agents) ? item.source_agents : []),
    item?.source_agent,
    item?.agent,
    item?.speaker,
    item?.provenance?.agent,
  ];
  const visibleText = String(passage || '');
  const speakers = [...visibleText.matchAll(/(?:^|\n)Speaker:\s*([^\n]+)/g)].map((match) => match[1].trim());
  const agentLabels = visibleText.match(/\bAgent[- ][A-Za-z0-9_]+\b/g) || [];
  return [...new Set([...direct, ...speakers, ...agentLabels]
    .filter((value) => value && !/^(?:not provided|unknown|none|null)$/i.test(String(value).trim()))
    .map((value) => String(value).trim()))];
}

const emptyLedger = () => ({
  schema_version: 1,
  provider: 'Moonshot',
  model: process.env.KIMI_JUDGE_MODEL || 'kimi-k2.6',
  temperature_control: 'provider_default_non_configurable',
  temperature_parameter_sent: false,
  call_limit: 40,
  calls: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  cached_tokens: 0,
  errors: 0,
  schema_failures: 0,
  structured_output_fallbacks: 0,
  consecutive_provider_errors: 0,
  consecutive_schema_failures: 0,
  attempts: [],
});

async function readLedger(file) {
  try { return { ...emptyLedger(), ...JSON.parse(await readFile(file, 'utf8')) }; } catch { return emptyLedger(); }
}

async function saveLedger(file, ledger) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

function kimiUsage(body) {
  const usage = body?.usage || {};
  const prompt = usage.prompt_tokens || 0;
  const completion = usage.completion_tokens || 0;
  const cached = usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    input_tokens: prompt,
    output_tokens: completion,
    cache_hit_input_tokens: cached,
    cache_miss_input_tokens: Math.max(0, prompt - cached),
    total_tokens: usage.total_tokens ?? prompt + completion,
    cached_tokens: cached,
  };
}

export class CognitiveProvider {
  constructor({ config, answerPrompt, judgePrompt, reviewPrompt, runRoot, brainServerRoot, kimiUsagePath }) {
    this.config = config;
    this.answerPrompt = answerPrompt;
    this.judgePrompt = judgePrompt;
    this.reviewPrompt = reviewPrompt;
    this.runRoot = runRoot;
    this.brainServerRoot = brainServerRoot;
    this.kimiUsagePath = kimiUsagePath || path.join(runRoot, 'kimi-usage.json');
  }

  async deepSeekChat({ system, payload, maxTokens, role }) {
    const apiUrl = process.env.LLM_API_URL;
    const apiKey = process.env.LLM_API_KEY;
    const model = role === 'secondary_review'
      ? (process.env.JUDGE_MODEL || this.config.secondary_review.model)
      : (process.env.ANSWER_MODEL || process.env.LLM_MODEL || this.config.answer.model);
    if (!apiUrl || !apiKey) throw new Error('DeepSeek provider environment is incomplete');
    let lastError;
    for (let attempt = 0; attempt <= this.config.max_retries; attempt++) {
      const start = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.request_timeout_ms);
      try {
        const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload, null, 2) }], temperature: 0, max_tokens: maxTokens, thinking: { type: 'disabled' }, stream: false, response_format: { type: 'json_object' } }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${(await response.text()).slice(0, 300)}`);
        const body = await response.json();
        const raw = body.choices?.[0]?.message?.content;
        if (!raw) throw new Error('DeepSeek returned empty content');
        return { structured: cleanJson(raw), raw, model, latency_ms: Date.now() - start, usage: kimiUsage(body), attempts: attempt + 1 };
      } catch (error) {
        lastError = error;
        if (attempt < this.config.max_retries) await new Promise((resolve) => setTimeout(resolve, this.config.retry_base_ms * (2 ** attempt)));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async reserveKimiAttempt({ responseFormat, fallbackReason = null, phase = 'development' }) {
    const ledger = await readLedger(this.kimiUsagePath);
    ledger.call_limit = this.config.primary_judge.call_limit;
    ledger.model = process.env.KIMI_JUDGE_MODEL || this.config.primary_judge.model;
    if (ledger.calls >= ledger.call_limit) throw new Error(`KIMI_CALL_LIMIT_REACHED:${ledger.calls}/${ledger.call_limit}`);
    if (ledger.consecutive_provider_errors >= 3) throw new Error('KIMI_STOP_CONDITION:three consecutive provider errors');
    if (ledger.consecutive_schema_failures >= 3) throw new Error('KIMI_STOP_CONDITION:three consecutive schema failures');
    const entry = { call_number: ledger.calls + 1, phase, started_at: new Date().toISOString(), response_format: responseFormat, structured_output_fallback: responseFormat === 'json_object', fallback_reason: fallbackReason, temperature_parameter_sent: false, status: 'started' };
    ledger.calls++;
    ledger.attempts.push(entry);
    await saveLedger(this.kimiUsagePath, ledger);
    return entry.call_number;
  }

  async updateKimiAttempt(callNumber, update, usage = null) {
    const ledger = await readLedger(this.kimiUsagePath);
    const entry = ledger.attempts.find((item) => item.call_number === callNumber);
    Object.assign(entry, update, { completed_at: new Date().toISOString() });
    if (usage) {
      ledger.prompt_tokens += usage.input_tokens;
      ledger.completion_tokens += usage.output_tokens;
      ledger.total_tokens += usage.total_tokens;
      ledger.cached_tokens += usage.cached_tokens;
    }
    if (update.status === 'provider_error') { ledger.errors++; ledger.consecutive_provider_errors++; }
    else if (update.status === 'schema_failure') { ledger.schema_failures++; ledger.consecutive_schema_failures++; ledger.consecutive_provider_errors = 0; }
    else if (update.status === 'completed') { ledger.consecutive_provider_errors = 0; ledger.consecutive_schema_failures = 0; }
    else if (update.status === 'response_format_unsupported') { ledger.consecutive_provider_errors = 0; }
    if (update.structured_output_fallback) ledger.structured_output_fallbacks++;
    await saveLedger(this.kimiUsagePath, ledger);
  }

  async kimiRequest({ payload, responseFormat = 'json_schema', fallbackReason = null, phase = 'development' }) {
    const apiUrl = process.env.KIMI_API_URL || 'https://api.moonshot.cn/v1';
    const apiKey = process.env.MOONSHOT_API_KEY;
    const model = process.env.KIMI_JUDGE_MODEL || this.config.primary_judge.model;
    if (!apiKey) throw new Error('KIMI_CREDENTIALS_MISSING:MOONSHOT_API_KEY');
    const callNumber = await this.reserveKimiAttempt({ responseFormat, fallbackReason, phase });
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.request_timeout_ms);
    try {
      const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: this.judgePrompt }, { role: 'user', content: JSON.stringify(payload, null, 2) }],
          thinking: { type: 'disabled' },
          stream: false,
          max_completion_tokens: this.config.primary_judge.max_completion_tokens,
          response_format: responseFormat === 'json_schema' ? { type: 'json_schema', json_schema: KIMI_JUDGE_SCHEMA_V2 } : { type: 'json_object' },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        const schemaUnsupported = [400, 404, 422].includes(response.status) && /schema|response_format|structured/i.test(detail);
        await this.updateKimiAttempt(callNumber, { status: schemaUnsupported ? 'response_format_unsupported' : 'provider_error', http_status: response.status, error: detail });
        const error = new Error(`Kimi ${response.status}: ${detail}`);
        error.schemaUnsupported = schemaUnsupported;
        error.nonRetryableConfiguration = response.status === 400 && /invalid temperature|only .* allowed/i.test(detail);
        throw error;
      }
      const body = await response.json();
      const raw = body.choices?.[0]?.message?.content;
      if (!raw) throw new Error('Kimi returned empty content');
      const usage = kimiUsage(body);
      // Defer parsing until judge() so malformed structured output is accounted
      // as a schema failure, not as a transport/provider failure.
      return { callNumber, raw, model: body.model || model, latency_ms: Date.now() - start, usage, attempts: 1, structured_output_fallback: responseFormat === 'json_object', fallback_reason: fallbackReason };
    } catch (error) {
      if (!error.schemaUnsupported) {
        const ledger = await readLedger(this.kimiUsagePath);
        const entry = ledger.attempts.find((item) => item.call_number === callNumber);
        if (entry?.status === 'started') await this.updateKimiAttempt(callNumber, { status: 'provider_error', error: error.message });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async answer({ scenario, mode, context }) {
    const result = await this.deepSeekChat({ role: 'answer', system: this.answerPrompt, maxTokens: this.config.answer.max_tokens, payload: { benchmark: 'Synthetic/Curated Development Evaluation', answer_schema: 'answer-schema-v2', mode, current_question: scenario.question, memory_context: context } });
    const visibleSourceIds = context.map((item) => item.source_id);
    const visibleAgents = [...new Set(context.flatMap((item) => item.source_agents || []))];
    result.structured = validateAnswerV2(result.structured, { visibleSourceIds, visibleAgents, allowEmptySources: mode === 'no_memory' });
    return result;
  }

  async judge({ scenario, answer, context, phase = 'development' }) {
    const payload = {
      scenario_id: scenario.scenario_id,
      category: scenario.category,
      question: scenario.question,
      visible_context: context,
      candidate_answer: answer,
      acceptable_insights: scenario.gold.acceptable_insights || [],
      acceptable_actions: scenario.gold.acceptable_actions || [],
      forbidden_inferences: scenario.gold.forbidden_inferences || [],
      unacceptable_actions: scenario.gold.unacceptable_actions || [],
      required_constraints: scenario.gold.required_constraints || [],
      required_option_comparison: scenario.gold.required_option_comparison || [],
    };
    let fallbackReason = null;
    for (let schemaAttempt = 0; schemaAttempt <= this.config.max_retries; schemaAttempt++) {
      let result;
      try {
        result = await this.kimiRequest({ payload, responseFormat: 'json_schema', phase });
      } catch (error) {
        if (!error.schemaUnsupported) {
          if (error.nonRetryableConfiguration) throw error;
          if (schemaAttempt < this.config.max_retries) continue;
          throw error;
        }
        fallbackReason = error.message;
        result = await this.kimiRequest({ payload, responseFormat: 'json_object', fallbackReason, phase });
      }
      try {
        result.structured = validateKimiJudgeV2(cleanJson(result.raw));
        await this.updateKimiAttempt(result.callNumber, { status: 'completed', structured_output_fallback: result.structured_output_fallback, fallback_reason: result.fallback_reason }, result.usage);
        return result;
      } catch (error) {
        await this.updateKimiAttempt(result.callNumber, { status: 'schema_failure', structured_output_fallback: result.structured_output_fallback, fallback_reason: result.fallback_reason, error: error.message }, result.usage);
        if (schemaAttempt >= this.config.max_retries) throw error;
      }
    }
    throw new Error('Kimi judge exhausted schema retries');
  }

  async agentReview(record) {
    const result = await this.deepSeekChat({ role: 'secondary_review', system: this.reviewPrompt, maxTokens: 500, payload: record });
    result.structured = validateAgentReview(result.structured);
    return result;
  }

  fixedRetrieval(scenario) {
    const terms = new Set(scenario.question.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    return scenario.events.map((event) => ({ ...event, lexical_score: (event.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((term) => terms.has(term)).length }))
      .sort((a, b) => b.lexical_score - a.lexical_score || a.id.localeCompare(b.id)).slice(0, this.config.retrieval_only.top_k);
  }

  async fullOmniContext(scenario, ordinal) {
    const scenarioRunDir = `${this.runRoot}/${scenario.scenario_id}/attempt-${ordinal}`;
    const runtime = createConversationRuntime({ runDir: scenarioRunDir, conversationId: 1, brainServerRoot: this.brainServerRoot });
    const started = Date.now();
    await runtime.start();
    let extractionCalls = 0;
    let extractionCharacters = 0;
    try {
      await runtime.client.rebuildEmbeddings();
      await runtime.client.preflight();
      const batchCount = Math.max(1, Math.min(4, (scenario.state_transition_count || 0) + 1));
      const size = Math.ceil(scenario.events.length / batchCount);
      const groups = Array.from({ length: batchCount }, (_, index) => scenario.events.slice(index * size, (index + 1) * size)).filter((group) => group.length);
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const text = group.map((event) => `[${event.id}] ${event.timestamp} ${event.agent}: ${event.text}`).join('\n');
        await runtime.client.extract(text, `Cognitive v1.1 ${scenario.scenario_id} batch${i + 1}`, { timestamp: group.at(-1).timestamp, sessionId: `${ordinal}-${i + 1}`, evaluationMode: true });
        extractionCalls++;
        extractionCharacters += text.length;
      }
      await runtime.client.rebuildEmbeddings();
      await runtime.client.preflight();
      const retrievalStart = Date.now();
      const retrieval = await runtime.client.unifiedMemorySearch(scenario.question, this.config.full_omni.top_k);
      const retrievalLatency = Date.now() - retrievalStart;
      const contextItems = (retrieval.finalContext || retrieval.evidence || retrieval.results || []).slice(0, this.config.full_omni.top_k).map((item, index) => {
        const text = item.passage || item.fact || item.description || JSON.stringify(item);
        return {
          source_id: item.evidence_id || item.id || `omni-${index + 1}`,
          text,
          source: 'full_omni',
          source_agents: evidenceSourceAgents(item, text),
        };
      });
      return { contextItems, diagnostics: { extraction_calls: extractionCalls, extraction_input_characters: extractionCharacters, retrieval_calls: 1, reranker_calls: 1, retrieval_latency_ms: retrievalLatency, runtime_startup_and_ingestion_ms: Date.now() - started, search_methods: retrieval.searchMethods || {} }, runtime };
    } catch (error) {
      await runtime.stop().catch(() => {});
      throw error;
    }
  }
}

export function syntheticOracleAnswer(scenario) {
  const facts = (scenario.gold.required_facts || []).map((value, index) => {
    const source = scenario.events.find((event) => String(event.value) === String(value)) || scenario.events[index % scenario.events.length];
    return { key: source.state_key || `required_${index + 1}`, value, state: scenario.gold.current_facts?.includes(value) ? 'current' : scenario.gold.historical_facts?.includes(value) ? 'historical' : 'supported', source_ids: [source.id], source_agents: [source.agent] };
  });
  const transitions = (scenario.gold.transitions || []).map((transition) => ({ ...transition, source_ids: scenario.events.filter((event) => [transition.from_value, transition.to_value].includes(event.value)).map((event) => event.id) }));
  const rejected = [...(scenario.gold.invalidated_facts || []).map((value) => ({ value, reason: 'invalidated' })), ...(scenario.gold.suppress || []).map((value) => ({ value, reason: 'noise' }))]
    .map((item) => ({ ...item, source_ids: scenario.events.filter((event) => String(event.value).includes(item.value) || event.text.includes(item.value)).map((event) => event.id) }));
  return { answer: `Synthetic harness calibration for ${scenario.scenario_id}.`, facts, transitions, constraints_used: scenario.gold.required_constraints || [], rejected_facts: rejected, insights: scenario.gold.acceptable_insights?.slice(0, 1) || [], actions: scenario.gold.acceptable_actions?.slice(0, 1) || [], uncertainty: null };
}
