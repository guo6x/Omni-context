import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createConversationRuntime } from '../../src/conversation-runtime.mjs';
import { KIMI_JUDGE_SCHEMA_V2, validateAnswerV2, validateKimiJudgeV2 } from './schemas.mjs';

function cleanJson(text) {
  return JSON.parse(String(text).replace(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g, '$1').trim());
}

function balancedJsonObjects(text) {
  const objects = [];
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === '{') depth++;
      else if (character === '}' && --depth === 0) {
        objects.push(text.slice(start, index + 1));
        start = index;
        break;
      }
    }
  }
  return objects;
}

export function parseStructuredJudgeResponse(raw) {
  const text = String(raw || '').trim();
  try { return JSON.parse(text); } catch {}
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    try { return JSON.parse(match[1].trim()); } catch {}
  }
  for (const object of balancedJsonObjects(text)) {
    try { return JSON.parse(object); } catch {}
  }
  const error = new Error('Kimi response does not contain a complete JSON object');
  error.failureType = 'malformed_json';
  throw error;
}

export function normalizeAnswerV2Shape(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.rejected_facts)) return { value, normalizations: [] };
  const normalizations = [];
  const normalized = { ...value, rejected_facts: value.rejected_facts.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const extras = Object.keys(item).filter((key) => !['value', 'reason', 'source_ids'].includes(key));
    if (extras.length === 1 && extras[0] === 'source_agents' && Array.isArray(item.source_agents)) {
      const { source_agents: _redundant, ...strictItem } = item;
      normalizations.push({ path: `rejected_facts[${index}].source_agents`, action: 'removed_redundant_non_schema_field' });
      return strictItem;
    }
    return item;
  }) };
  return { value: normalized, normalizations };
}

const emptyUsage = () => ({ input_tokens: 0, output_tokens: 0, cache_hit_input_tokens: 0, cache_miss_input_tokens: 0, total_tokens: 0, cached_tokens: 0 });
function addUsage(target, usage) {
  for (const key of Object.keys(target)) target[key] += usage?.[key] || 0;
  return target;
}
function safeRawSummary(raw, finishReason) {
  const text = String(raw || '');
  return { raw_character_count: [...text].length, finish_reason: finishReason || null, first_200: [...text].slice(0, 200).join(''), last_200: [...text].slice(-200).join('') };
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label} keys do not match schema`);
}

export function validateAgentReview(value) {
  const issueKeys = ['score_issue', 'gold_ambiguity', 'baseline_fairness_issue', 'memory_leakage_issue', 'judge_reliability_issue', 'provenance_issue', 'invalidated_fact_rejection_issue', 'temporal_transition_issue'];
  exactKeys(value, ['scenario_id', 'verdict', ...issueKeys, 'notes'], 'agent review');
  if (typeof value.scenario_id !== 'string' || !['agree', 'flag'].includes(value.verdict) || typeof value.notes !== 'string') throw new Error('agent review identity/verdict invalid');
  for (const key of issueKeys) if (typeof value[key] !== 'boolean') throw new Error(`${key} must be boolean`);
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
  schema_version: 2,
  provider: 'Moonshot',
  model: process.env.KIMI_JUDGE_MODEL || 'kimi-k2.6',
  judge_adapter_version: 'kimi-judge-adapter-v2.1',
  judge_rubric_version: 'kimi-judge-rubric-v2',
  temperature_control: 'provider_default_non_configurable',
  temperature_parameter_sent: false,
  call_limit: 60,
  calls: 0,
  physical_attempts: 0,
  logical_judge_calls: 0,
  successful_logical_calls: 0,
  truncated_attempts: 0,
  malformed_attempts: 0,
  schema_validation_failures: 0,
  retries_recovered: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  cached_tokens: 0,
  errors: 0,
  schema_failures: 0,
  structured_output_fallbacks: 0,
  consecutive_provider_errors: 0,
  consecutive_schema_failures: 0,
  logical_calls: [],
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
  constructor({ config, answerPrompt, judgePrompt, reviewPrompt, runRoot, brainServerRoot, expectedProductCommit, expectedSelectorVersion, kimiUsagePath }) {
    this.config = config;
    this.answerPrompt = answerPrompt;
    this.judgePrompt = judgePrompt;
    this.reviewPrompt = reviewPrompt;
    this.runRoot = runRoot;
    this.brainServerRoot = brainServerRoot;
    this.expectedProductCommit = expectedProductCommit;
    this.expectedSelectorVersion = expectedSelectorVersion;
    this.kimiUsagePath = kimiUsagePath || path.join(runRoot, 'kimi-usage.json');
  }

  async deepSeekChat({ system, payload, maxTokens, role, diagnosticContext = null }) {
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
        const finishReason = body.choices?.[0]?.finish_reason ?? null;
        const rawUsage = body.usage || null;
        let structured;
        let parseError = null;
        try {
          structured = cleanJson(raw);
        } catch (e) {
          parseError = e;
        }
        if (diagnosticContext) {
          await this._recordAnswerDiagnostic({ ...diagnosticContext, finishReason, rawUsage, raw, model, maxTokens, physicalAttempt: attempt + 1, parseError });
        }
        if (parseError) throw parseError;
        return { structured, raw, model, latency_ms: Date.now() - start, usage: kimiUsage(body), attempts: attempt + 1 };
      } catch (error) {
        lastError = error;
        if (attempt < this.config.max_retries) await new Promise((resolve) => setTimeout(resolve, this.config.retry_base_ms * (2 ** attempt)));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  async _recordAnswerDiagnostic({ scenario_id, validation_attempt, run_root, finishReason, rawUsage, raw, model, maxTokens, physicalAttempt, parseError }) {
    const responseText = String(raw || '');
    let jsonParseSucceeded = false;
    let jsonParseError = null;
    let jsonParseErrorPosition = null;
    if (parseError) {
      jsonParseError = parseError.message || String(parseError);
      const posMatch = jsonParseError.match(/position\s+(\d+)/i);
      if (posMatch) jsonParseErrorPosition = Number(posMatch[1]);
    } else {
      jsonParseSucceeded = true;
    }
    let responseEndedMidString = false;
    try {
      JSON.parse(responseText);
    } catch (e) {
      const trimmed = responseText.trimEnd();
      const lastChar = trimmed[trimmed.length - 1];
      if (lastChar !== '}' && lastChar !== ']') responseEndedMidString = true;
    }
    let responseEndedWithCompleteJsonShape = false;
    try {
      JSON.parse(responseText);
      responseEndedWithCompleteJsonShape = true;
    } catch {}
    const diagnostic = {
      scenario_id: scenario_id || null,
      attempt: physicalAttempt || 1,
      validation_attempt: validation_attempt || null,
      provider: 'DeepSeek',
      model: model || null,
      requested_max_tokens: maxTokens ?? null,
      finish_reason: finishReason,
      prompt_tokens: rawUsage?.prompt_tokens ?? null,
      completion_tokens: rawUsage?.completion_tokens ?? null,
      total_tokens: rawUsage?.total_tokens ?? null,
      response_content_characters: [...responseText].length,
      raw_response_content: responseText,
      json_parse_succeeded: jsonParseSucceeded,
      json_parse_error: jsonParseError,
      json_parse_error_position: jsonParseErrorPosition,
      response_ended_mid_string: responseEndedMidString,
      response_ended_with_complete_json_shape: responseEndedWithCompleteJsonShape,
      recorded_at: new Date().toISOString(),
    };
    try {
      const dir = path.join(run_root || this.runRoot || '.', 'answer-diagnostics');
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, (scenario_id || 'unknown') + '-v' + (validation_attempt || 0) + '-p' + (physicalAttempt || 1) + '.json');
      await writeFile(file, JSON.stringify(diagnostic, null, 2) + '\n');
    } catch {}
    return diagnostic;
  }

  async reserveKimiLogicalCall({ phase, scenarioId }) {
    const ledger = await readLedger(this.kimiUsagePath);
    const entry = { logical_call_number: ledger.logical_judge_calls + 1, phase, scenario_id: scenarioId, started_at: new Date().toISOString(), status: 'started', physical_attempts: [] };
    ledger.logical_judge_calls++;
    ledger.logical_calls.push(entry);
    await saveLedger(this.kimiUsagePath, ledger);
    return entry.logical_call_number;
  }

  async completeKimiLogicalCall(logicalCallNumber, { status, physicalAttempts, error = null }) {
    const ledger = await readLedger(this.kimiUsagePath);
    const entry = ledger.logical_calls.find((item) => item.logical_call_number === logicalCallNumber);
    Object.assign(entry, { status, physical_attempt_count: physicalAttempts, error, completed_at: new Date().toISOString() });
    if (status === 'completed') {
      ledger.successful_logical_calls++;
      if (physicalAttempts > 1) ledger.retries_recovered++;
    }
    await saveLedger(this.kimiUsagePath, ledger);
  }

  async reserveKimiAttempt({ responseFormat, fallbackReason = null, phase = 'development', logicalCallNumber, physicalAttempt }) {
    const ledger = await readLedger(this.kimiUsagePath);
    ledger.call_limit = this.config.primary_judge.call_limit;
    ledger.model = process.env.KIMI_JUDGE_MODEL || this.config.primary_judge.model;
    ledger.judge_adapter_version = this.config.primary_judge.adapter_version;
    ledger.judge_rubric_version = this.config.primary_judge.rubric_version;
    if (ledger.calls >= ledger.call_limit) throw new Error(`KIMI_CALL_LIMIT_REACHED:${ledger.calls}/${ledger.call_limit}`);
    if (ledger.consecutive_provider_errors >= 3) throw new Error('KIMI_STOP_CONDITION:three consecutive provider errors');
    const entry = { call_number: ledger.calls + 1, logical_call_number: logicalCallNumber, physical_attempt: physicalAttempt, phase, started_at: new Date().toISOString(), response_format: responseFormat, structured_output_fallback: responseFormat === 'json_object', fallback_reason: fallbackReason, temperature_parameter_sent: false, status: 'started' };
    ledger.calls++;
    ledger.physical_attempts++;
    ledger.attempts.push(entry);
    const logical = ledger.logical_calls.find((item) => item.logical_call_number === logicalCallNumber);
    if (logical) logical.physical_attempts.push(entry.call_number);
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
    else if (update.status === 'schema_failure') {
      ledger.schema_failures++;
      ledger.consecutive_schema_failures++;
      ledger.consecutive_provider_errors = 0;
      if (update.failure_type === 'output_truncated') ledger.truncated_attempts++;
      else if (update.failure_type === 'malformed_json') ledger.malformed_attempts++;
      else if (update.failure_type === 'schema_validation_failure') ledger.schema_validation_failures++;
    }
    else if (update.status === 'completed') { ledger.consecutive_provider_errors = 0; ledger.consecutive_schema_failures = 0; }
    else if (update.status === 'response_format_unsupported') { ledger.consecutive_provider_errors = 0; }
    if (update.structured_output_fallback) ledger.structured_output_fallbacks++;
    await saveLedger(this.kimiUsagePath, ledger);
  }

  async kimiRequest({ payload, responseFormat = 'json_schema', fallbackReason = null, phase = 'development', logicalCallNumber, physicalAttempt, retryDirective = null }) {
    const apiUrl = process.env.KIMI_API_URL || 'https://api.moonshot.cn/v1';
    const apiKey = process.env.MOONSHOT_API_KEY;
    const model = process.env.KIMI_JUDGE_MODEL || this.config.primary_judge.model;
    if (!apiKey) throw new Error('KIMI_CREDENTIALS_MISSING:MOONSHOT_API_KEY');
    const callNumber = await this.reserveKimiAttempt({ responseFormat, fallbackReason, phase, logicalCallNumber, physicalAttempt });
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.request_timeout_ms);
    try {
      const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: retryDirective ? `${this.judgePrompt}\n\n${retryDirective}` : this.judgePrompt }, { role: 'user', content: JSON.stringify(payload, null, 2) }],
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
      const choice = body.choices?.[0];
      const raw = choice?.message?.content;
      if (!raw) throw new Error('Kimi returned empty content');
      const usage = kimiUsage(body);
      // Defer parsing until judge() so malformed structured output is accounted
      // as a schema failure, not as a transport/provider failure.
      return { callNumber, raw, finish_reason: choice.finish_reason || null, raw_character_count: [...String(raw)].length, model: body.model || model, latency_ms: Date.now() - start, usage, attempts: 1, structured_output_fallback: responseFormat === 'json_object', fallback_reason: fallbackReason };
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
    const visibleSourceIds = context.map((item) => item.source_id);
    const visibleAgents = [...new Set(context.flatMap((item) => item.source_agents || []))];
    const payload = { benchmark: 'Synthetic/Curated Development Evaluation', answer_schema: 'answer-schema-v2', mode, current_question: scenario.question, memory_context: context };
    let lastError;
    for (let validationAttempt = 1; validationAttempt <= 3; validationAttempt++) {
      const correction = validationAttempt > 1 ? '\n\nYour previous JSON failed answer-schema-v2 validation. Return only the exact keys and shapes stated above. Do not add fields to facts, transitions, or rejected_facts. Every memory-backed source_ids array must contain exact visible IDs.' : '';
      const result = await this.deepSeekChat({ role: 'answer', system: `${this.answerPrompt}${correction}`, maxTokens: this.config.answer.max_tokens, payload, diagnosticContext: { scenario_id: scenario.scenario_id, validation_attempt: validationAttempt, run_root: this.runRoot } });
      try {
        const normalized = normalizeAnswerV2Shape(result.structured);
        result.structured = validateAnswerV2(normalized.value, { visibleSourceIds, visibleAgents, allowEmptySources: mode === 'no_memory' });
        result.schema_normalizations = normalized.normalizations;
        result.schema_validation_attempts = validationAttempt;
        return result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
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
    const logicalCallNumber = await this.reserveKimiLogicalCall({ phase, scenarioId: scenario.scenario_id });
    const totalUsage = emptyUsage();
    let totalLatency = 0;
    let fallbackReason = null;
    const retryDirective = 'Your previous response was invalid or truncated. Return only compact JSON matching the exact schema. Do not use Markdown. Rationale <= 160 characters. Lists <= 3 items.';
    for (let physicalAttempt = 1; physicalAttempt <= 3; physicalAttempt++) {
      let result;
      try {
        result = await this.kimiRequest({ payload, responseFormat: 'json_schema', phase, logicalCallNumber, physicalAttempt, retryDirective: physicalAttempt > 1 ? retryDirective : null });
      } catch (error) {
        if (!error.schemaUnsupported) {
          if (error.nonRetryableConfiguration) {
            await this.completeKimiLogicalCall(logicalCallNumber, { status: 'error', physicalAttempts: physicalAttempt, error: error.message });
            throw error;
          }
          if (physicalAttempt < 3) continue;
          await this.completeKimiLogicalCall(logicalCallNumber, { status: 'error', physicalAttempts: physicalAttempt, error: error.message });
          throw error;
        }
        fallbackReason = error.message;
        result = await this.kimiRequest({ payload, responseFormat: 'json_object', fallbackReason, phase, logicalCallNumber, physicalAttempt, retryDirective: physicalAttempt > 1 ? retryDirective : null });
      }
      addUsage(totalUsage, result.usage);
      totalLatency += result.latency_ms;
      try {
        if (result.finish_reason === 'length') {
          const error = new Error('Kimi structured output was truncated by completion length');
          error.failureType = 'output_truncated';
          throw error;
        }
        const parsed = parseStructuredJudgeResponse(result.raw);
        try { result.structured = validateKimiJudgeV2(parsed); }
        catch (error) { error.failureType = 'schema_validation_failure'; throw error; }
        await this.updateKimiAttempt(result.callNumber, { status: 'completed', finish_reason: result.finish_reason, completion_tokens: result.usage.output_tokens, raw_character_count: result.raw_character_count, structured_output_fallback: result.structured_output_fallback, fallback_reason: result.fallback_reason }, result.usage);
        await this.completeKimiLogicalCall(logicalCallNumber, { status: 'completed', physicalAttempts: physicalAttempt });
        return { ...result, usage: totalUsage, latency_ms: totalLatency, logical_judge_call: logicalCallNumber, physical_attempts: physicalAttempt, retries_recovered: physicalAttempt > 1, judge_adapter_version: this.config.primary_judge.adapter_version, judge_rubric_version: this.config.primary_judge.rubric_version };
      } catch (error) {
        const failureType = error.failureType || 'malformed_json';
        await this.updateKimiAttempt(result.callNumber, { status: 'schema_failure', failure_type: failureType, finish_reason: result.finish_reason, completion_tokens: result.usage.output_tokens, raw_character_count: result.raw_character_count, raw_summary: safeRawSummary(result.raw, result.finish_reason), structured_output_fallback: result.structured_output_fallback, fallback_reason: result.fallback_reason, error: error.message }, result.usage);
        if (physicalAttempt >= 3) {
          await this.completeKimiLogicalCall(logicalCallNumber, { status: 'error', physicalAttempts: physicalAttempt, error: `${failureType}:${error.message}` });
          throw error;
        }
      }
    }
    throw new Error('Kimi judge exhausted schema retries');
  }

  async agentReview(record) {
    let lastError;
    for (let validationAttempt = 1; validationAttempt <= 3; validationAttempt++) {
      const correction = validationAttempt > 1 ? '\n\nYour previous JSON failed validation. Return only the exact requested keys; every issue field must be boolean.' : '';
      const result = await this.deepSeekChat({ role: 'secondary_review', system: `${this.reviewPrompt}${correction}`, maxTokens: 500, payload: record });
      try {
        result.structured = validateAgentReview(result.structured);
        result.schema_validation_attempts = validationAttempt;
        return result;
      } catch (error) { lastError = error; }
    }
    throw lastError;
  }

  fixedRetrieval(scenario) {
    const terms = new Set(scenario.question.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    return scenario.events.map((event) => ({ ...event, lexical_score: (event.text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((term) => terms.has(term)).length }))
      .sort((a, b) => b.lexical_score - a.lexical_score || a.id.localeCompare(b.id)).slice(0, this.config.retrieval_only.top_k);
  }

  async preflightRuntime() {
    const runDir = path.join(this.runRoot, '_runtime-preflight');
    const runtime = createConversationRuntime({
      runDir,
      conversationId: 1,
      brainServerRoot: this.brainServerRoot,
      expectedProductCommit: this.expectedProductCommit,
      expectedSelectorVersion: this.expectedSelectorVersion,
    });
    try {
      await runtime.start();
      await runtime.client.rebuildEmbeddings();
      const checks = await runtime.client.preflight();
      return {
        status: 'passed',
        runtime_attestation: runtime.getAttestation(),
        embedding: checks.embeddingStatus,
        health: checks.health,
      };
    } finally {
      await runtime.stop().catch(() => {});
    }
  }

  async retrievalPreflight(scenario, ordinal) {
    const full = await this.fullOmniContext(scenario, ordinal);
    try {
      return {
        retrieval: full.rawRetrieval,
        diagnostics: full.diagnostics,
      };
    } finally {
      await full.runtime.stop().catch(() => {});
    }
  }

  async fullOmniContext(scenario, ordinal) {
    const scenarioRunDir = `${this.runRoot}/${scenario.scenario_id}/attempt-${ordinal}`;
    const runtime = createConversationRuntime({
      runDir: scenarioRunDir,
      conversationId: 1,
      brainServerRoot: this.brainServerRoot,
      expectedProductCommit: this.expectedProductCommit,
      expectedSelectorVersion: this.expectedSelectorVersion,
      extraEnv: {
        OMNI_EVALUATION_TRACE_DIR: path.join(scenarioRunDir, 'conversation-1'),
      },
    });
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
      return { contextItems, rawRetrieval: retrieval, diagnostics: { extraction_calls: extractionCalls, extraction_input_characters: extractionCharacters, retrieval_calls: 1, reranker_calls: 1, retrieval_latency_ms: retrievalLatency, runtime_startup_and_ingestion_ms: Date.now() - started, search_methods: retrieval.searchMethods || {}, runtime_attestation: runtime.getAttestation() }, runtime };
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
