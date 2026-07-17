import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertGoldFree } from '../lib/sealed.mjs';

export const KIMI_SCORER_VERSION = '1';
export const KIMI_JUDGE_MODEL = 'kimi-k2.6';
export const KIMI_JUDGE_PROVIDER = 'Moonshot';
export const KIMI_MAX_RETRIES = 2;
export const KIMI_MAX_OUTPUT_TOKENS = 10;
export const METRIC_NAME = 'Kimi-K2.6-judged LongMemEval-S QA accuracy';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = path.join(MODULE_DIR, 'prompts', 'kimi-longmemeval-judge-v1.txt');
const SCHEMA_PATH = path.join(MODULE_DIR, 'schemas', 'kimi-longmemeval-judge-v1.json');

const RETRYABLE_ERRORS = new Set(['schema_validation', '429', '5xx', 'network', 'timeout']);

export async function loadJudgePrompt() {
  const raw = await readFile(PROMPT_PATH, 'utf8');
  return raw.replace(/\r\n/g, '\n');
}

export async function computeJudgePromptSha256() {
  const prompt = await loadJudgePrompt();
  return createHash('sha256').update(prompt).digest('hex');
}

export async function loadJudgeSchema() {
  return JSON.parse(await readFile(SCHEMA_PATH, 'utf8'));
}

export function buildJudgeInput(result, goldEntry) {
  if (!result || typeof result !== 'object') throw new Error('JUDGE_INPUT_RESULT_INVALID');
  if (!goldEntry || typeof goldEntry !== 'object') throw new Error('JUDGE_INPUT_GOLD_INVALID');
  const abstained = result.abstained === true || result.hypothesis === null || result.hypothesis === undefined || result.hypothesis === '';
  return {
    question_id: result.question_id,
    question_type: goldEntry.question_type || null,
    question: goldEntry.question,
    reference_answer: goldEntry.answer || goldEntry.reference_answer || null,
    hypothesis: result.hypothesis,
    abstained,
  };
}

function classifyError(error) {
  const msg = String(error?.message || error || '');
  if (/429|rate.?limit/i.test(msg)) return '429';
  if (/5\d{2}|server.?error|internal.?error/i.test(msg)) return '5xx';
  if (/timeout|timed.?out/i.test(msg)) return 'timeout';
  if (/network|econnreset|enotfound|eai_again|econnrefused|socket/i.test(msg)) return 'network';
  if (/schema.?validation|invalid.?json|parse|unexpected.?token/i.test(msg)) return 'schema_validation';
  return 'unknown';
}

async function defaultCallMoonshot({ apiKey, baseUrl, model, systemPrompt, userContent, maxOutputTokens, sendTemperature, signal }) {
  const url = `${baseUrl}/chat/completions`;
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    max_tokens: maxOutputTokens,
  };
  if (sendTemperature) body.temperature = 0;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`MOONSHOT_API_ERROR:${response.status}:${text.slice(0, 200)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const usage = data?.usage || null;
  return { content, usage };
}

function parseJudgeOutput(content) {
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('SCHEMA_VALIDATION_FAILED:empty_content');
  }
  let parsed;
  try {
    const match = content.match(/\{[^}]*\}/);
    parsed = JSON.parse(match ? match[0] : content);
  } catch (e) {
    throw new Error(`SCHEMA_VALIDATION_FAILED:parse:${content.slice(0, 100)}`);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('SCHEMA_VALIDATION_FAILED:not_object');
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== 'label') {
    throw new Error(`SCHEMA_VALIDATION_FAILED:additional_properties:${keys.join(',')}`);
  }
  if (parsed.label !== 'yes' && parsed.label !== 'no') {
    throw new Error(`SCHEMA_VALIDATION_FAILED:invalid_label:${String(parsed.label)}`);
  }
  return parsed.label;
}

export async function callJudgeWithDeps({
  callMoonshot = defaultCallMoonshot,
  apiKey,
  baseUrl = 'https://api.moonshot.cn/v1',
  model = KIMI_JUDGE_MODEL,
  systemPrompt,
  userContent,
  maxOutputTokens = KIMI_MAX_OUTPUT_TOKENS,
  maxRetries = KIMI_MAX_RETRIES,
  signal,
}) {
  if (!apiKey) throw new Error('KIMI_API_KEY_REQUIRED:MOONSHOT_API_KEY');
  let sendTemperature = true;
  let temperatureParameterSent = false;
  let lastError = null;
  let lastErrorType = 'unknown';
  let lastUsage = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    try {
      const result = await callMoonshot({
        apiKey,
        baseUrl,
        model,
        systemPrompt,
        userContent,
        maxOutputTokens,
        sendTemperature,
        signal,
      });
      temperatureParameterSent = sendTemperature;
      const label = parseJudgeOutput(result.content);
      lastUsage = result.usage;
      return {
        label,
        attempts: attempt + 1,
        usage: result.usage,
        latency_ms: Date.now() - startedMs,
        error_type: null,
        temperature_parameter_sent: temperatureParameterSent,
        attempt_log: { attempt: attempt + 1, status: 'ok', error_type: null, started_at: startedAt, completed_at: new Date().toISOString() },
      };
    } catch (error) {
      lastError = error;
      lastErrorType = classifyError(error);
      const isTemperatureError = /temperature|param.*not.*allowed|invalid.*temperature|unsupported.*param/i.test(String(error.message));
      if (isTemperatureError && sendTemperature) {
        sendTemperature = false;
        temperatureParameterSent = false;
        continue;
      }
      if (!RETRYABLE_ERRORS.has(lastErrorType) || attempt === maxRetries) {
        return {
          label: null,
          attempts: attempt + 1,
          usage: lastUsage,
          latency_ms: Date.now() - startedMs,
          error_type: lastErrorType,
          temperature_parameter_sent: temperatureParameterSent,
          attempt_log: { attempt: attempt + 1, status: 'error', error_type: lastErrorType, started_at: startedAt, completed_at: new Date().toISOString() },
        };
      }
      const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  return {
    label: null,
    attempts: maxRetries + 1,
    usage: lastUsage,
    latency_ms: 0,
    error_type: lastError ? classifyError(lastError) : 'unknown',
    temperature_parameter_sent: temperatureParameterSent,
  };
}

export async function scoreWithDeps({ results, gold, deps }) {
  const {
    callMoonshot = defaultCallMoonshot,
    apiKey = process.env.MOONSHOT_API_KEY,
    baseUrl = process.env.MOONSHOT_BASE_URL || 'https://api.moonshot.cn/v1',
    model = KIMI_JUDGE_MODEL,
    maxRetries = KIMI_MAX_RETRIES,
    maxOutputTokens = KIMI_MAX_OUTPUT_TOKENS,
    signal,
    fullLogDir,
    sanitizedLogPath,
  } = deps || {};

  if (!apiKey) throw new Error('KIMI_API_KEY_REQUIRED:MOONSHOT_API_KEY');
  if (!Array.isArray(results)) throw new Error('SCORE_RESULTS_NOT_ARRAY');
  if (!Array.isArray(gold)) throw new Error('SCORE_GOLD_NOT_ARRAY');

  const systemPrompt = await loadJudgePrompt();
  const promptSha256 = await computeJudgePromptSha256();

  const goldMap = new Map();
  for (const entry of gold) {
    if (entry && entry.question_id) goldMap.set(entry.question_id, entry);
  }

  let correct = 0;
  let scored = 0;
  let errors = 0;
  const sanitizedLogs = [];
  const fullLogs = [];

  for (const result of results) {
    const goldEntry = goldMap.get(result.question_id);
    if (!goldEntry) continue;
    assertGoldFree(result);
    const judgeInput = buildJudgeInput(result, goldEntry);
    const userContent = JSON.stringify(judgeInput);

    const judgeResult = await callJudgeWithDeps({
      callMoonshot,
      apiKey,
      baseUrl,
      model,
      systemPrompt,
      userContent,
      maxOutputTokens,
      maxRetries,
      signal,
    });

    scored++;
    if (judgeResult.label === null) {
      errors++;
    } else if (judgeResult.label === 'yes') {
      correct++;
    }

    fullLogs.push({
      question_id: result.question_id,
      question_type: judgeInput.question_type,
      question: judgeInput.question,
      reference_answer: judgeInput.reference_answer,
      hypothesis: judgeInput.hypothesis,
      abstained: judgeInput.abstained,
      label: judgeResult.label,
      attempts: judgeResult.attempts,
      usage: judgeResult.usage,
      latency_ms: judgeResult.latency_ms,
      error_type: judgeResult.error_type,
      temperature_parameter_sent: judgeResult.temperature_parameter_sent,
    });

    sanitizedLogs.push({
      question_id: result.question_id,
      label: judgeResult.label,
      attempts: judgeResult.attempts,
      usage: judgeResult.usage,
      latency_ms: judgeResult.latency_ms,
      error_type: judgeResult.error_type,
    });
  }

  if (fullLogDir) {
    await mkdir(fullLogDir, { recursive: true });
    const fullLogPath = path.join(fullLogDir, `kimi-judge-full-${Date.now()}.jsonl`);
    await writeFile(fullLogPath, fullLogs.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  }

  if (sanitizedLogPath) {
    await mkdir(path.dirname(sanitizedLogPath), { recursive: true });
    await writeFile(sanitizedLogPath, sanitizedLogs.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  }

  const accuracy = scored > 0 ? correct / scored : 0;
  const completionRate = results.length > 0 ? scored / results.length : 0;
  const terminalErrorRate = results.length > 0 ? errors / results.length : 0;

  const anyTemperatureSent = fullLogs.some((l) => l.temperature_parameter_sent === true);
  const temperatureControl = anyTemperatureSent ? '0' : 'provider_default_non_configurable';

  return {
    metric_name: METRIC_NAME,
    metric_value: accuracy,
    completion_rate: completionRate,
    terminal_error_rate: terminalErrorRate,
    scored,
    correct,
    errors,
    total: results.length,
    judge_model: KIMI_JUDGE_MODEL,
    judge_provider: KIMI_JUDGE_PROVIDER,
    judge_prompt_sha256: promptSha256,
    judge_max_retries: maxRetries,
    judge_max_output_tokens: maxOutputTokens,
    temperature_control: temperatureControl,
    temperature_parameter_sent: anyTemperatureSent,
    official_gpt4o_scoring_performed: false,
    leaderboard_comparable: false,
    sanitized_log_entries: sanitizedLogs.length,
  };
}

export async function score(results, gold) {
  return scoreWithDeps({ results, gold, deps: {} });
}
