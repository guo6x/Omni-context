import { createConversationRuntime } from '../../src/conversation-runtime.mjs';

function cleanJson(text) {
  return JSON.parse(String(text).replace(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g, '$1').trim());
}

function requireExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} keys do not match the fixed schema`);
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} must be a string array`);
}

export function validateAnswer(value) {
  requireExactKeys(value, ['answer', 'facts', 'constraints_used', 'rejected_facts', 'insights', 'actions', 'uncertainty'], 'answer');
  if (typeof value.answer !== 'string' || !Array.isArray(value.facts)) throw new Error('answer text/facts schema invalid');
  for (const fact of value.facts) {
    requireExactKeys(fact, ['key', 'value', 'source_ids'], 'fact');
    if (typeof fact.key !== 'string' || typeof fact.value !== 'string') throw new Error('fact key/value must be strings');
    requireStringArray(fact.source_ids, 'fact.source_ids');
  }
  for (const key of ['constraints_used', 'rejected_facts', 'insights', 'actions']) requireStringArray(value[key], key);
  if (value.uncertainty !== null && typeof value.uncertainty !== 'string') throw new Error('uncertainty must be string or null');
  return value;
}

const RUBRIC_KEYS = ['insight_precision', 'insight_recall', 'blind_spot_detection', 'constraint_awareness', 'actionability', 'goal_alignment', 'option_comparison', 'risk_awareness', 'internal_consistency', 'overall_quality'];
export function validateJudge(value) {
  requireExactKeys(value, ['rubric_scores', 'unsupported_claim_rate', 'overreach_rate', 'rationale'], 'judge');
  requireExactKeys(value.rubric_scores, RUBRIC_KEYS, 'judge.rubric_scores');
  for (const key of [...RUBRIC_KEYS.map((name) => ['rubric_scores', name]), ['root', 'unsupported_claim_rate'], ['root', 'overreach_rate']]) {
    const score = key[0] === 'root' ? value[key[1]] : value.rubric_scores[key[1]];
    if (typeof score !== 'number' || score < 0 || score > 1) throw new Error(`judge score ${key[1]} must be within [0,1]`);
  }
  if (typeof value.rationale !== 'string') throw new Error('judge rationale must be a string');
  return value;
}

export function validateAgentReview(value) {
  requireExactKeys(value, ['scenario_id', 'verdict', 'score_issue', 'gold_ambiguity', 'baseline_fairness_issue', 'memory_leakage_issue', 'notes'], 'agent review');
  if (typeof value.scenario_id !== 'string' || !['agree', 'flag'].includes(value.verdict) || typeof value.notes !== 'string') throw new Error('agent review identity/verdict schema invalid');
  for (const key of ['score_issue', 'gold_ambiguity', 'baseline_fairness_issue', 'memory_leakage_issue']) if (typeof value[key] !== 'boolean') throw new Error(`${key} must be boolean`);
  return value;
}

export class CognitiveProvider {
  constructor({ config, answerPrompt, judgePrompt, reviewPrompt, runRoot, brainServerRoot }) {
    this.config = config;
    this.answerPrompt = answerPrompt;
    this.judgePrompt = judgePrompt;
    this.reviewPrompt = reviewPrompt;
    this.runRoot = runRoot;
    this.brainServerRoot = brainServerRoot;
  }

  async chat({ role, system, payload, maxTokens }) {
    const apiUrl = role === 'judge' && process.env.JUDGE_API_URL ? process.env.JUDGE_API_URL : process.env.LLM_API_URL;
    const apiKey = role === 'judge' && process.env.JUDGE_API_KEY ? process.env.JUDGE_API_KEY : process.env.LLM_API_KEY;
    const model = role === 'judge' ? (process.env.JUDGE_MODEL || this.config.judge.model) : (process.env.ANSWER_MODEL || process.env.LLM_MODEL || this.config.answer.model);
    if (!apiUrl || !apiKey) throw new Error('Provider environment is incomplete.');
    let lastError;
    for (let attempt = 0; attempt <= this.config.max_retries; attempt++) {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.request_timeout_ms);
        const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload, null, 2) }],
            temperature: 0,
            max_tokens: maxTokens,
            thinking: { type: 'disabled' },
            response_format: { type: 'json_object' },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) throw new Error(`Provider ${response.status}: ${(await response.text()).slice(0, 300)}`);
        const body = await response.json();
        const raw = body.choices?.[0]?.message?.content;
        if (!raw) throw new Error('Provider returned empty content.');
        return {
          structured: cleanJson(raw),
          raw,
          model,
          latency_ms: Date.now() - start,
          usage: {
            input_tokens: body.usage?.prompt_tokens || 0,
            output_tokens: body.usage?.completion_tokens || 0,
            cache_hit_input_tokens: body.usage?.prompt_cache_hit_tokens || 0,
            cache_miss_input_tokens: body.usage?.prompt_cache_miss_tokens || body.usage?.prompt_tokens || 0,
          },
          attempts: attempt + 1,
        };
      } catch (error) {
        lastError = error;
        if (attempt < this.config.max_retries) await new Promise((resolve) => setTimeout(resolve, this.config.retry_base_ms * (2 ** attempt)));
      }
    }
    throw lastError;
  }

  async answer({ scenario, mode, context }) {
    const result = await this.chat({
      role: 'answer',
      system: this.answerPrompt,
      maxTokens: this.config.answer.max_tokens,
      payload: { benchmark: 'Synthetic/Curated Development Evaluation', mode, current_question: scenario.question, memory_context: context },
    });
    result.structured = validateAnswer(result.structured);
    return result;
  }

  async judge({ scenario, answer, context }) {
    const result = await this.chat({
      role: 'judge',
      system: this.judgePrompt,
      maxTokens: this.config.judge.max_tokens,
      payload: {
        scenario_id: scenario.scenario_id,
        category: scenario.category,
        question: scenario.question,
        visible_context: context,
        candidate_answer: answer,
        acceptable_insights: scenario.gold.acceptable_insights || [],
        acceptable_actions: scenario.gold.acceptable_actions || [],
        forbidden_inferences: scenario.gold.forbidden_inferences || [],
        required_constraints: scenario.gold.required_constraints || [],
        required_option_comparison: scenario.gold.required_option_comparison || [],
      },
    });
    result.structured = validateJudge(result.structured);
    return result;
  }

  async agentReview(record) {
    const result = await this.chat({ role: 'judge', system: this.reviewPrompt, maxTokens: 500, payload: record });
    result.structured = validateAgentReview(result.structured);
    return result;
  }

  fixedRetrieval(scenario) {
    const terms = new Set(scenario.question.toLowerCase().match(/[a-z0-9]+/g) || []);
    return scenario.events.map((event) => ({
      ...event,
      lexical_score: (event.text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((term) => terms.has(term)).length,
    })).sort((a, b) => b.lexical_score - a.lexical_score || a.id.localeCompare(b.id)).slice(0, this.config.retrieval_only.top_k);
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
      const groups = scenario.category === 'memory_evolution' || scenario.category === 'conflict_resolution'
        ? [scenario.events.slice(0, 2), scenario.events.slice(2)]
        : [scenario.events];
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const text = group.map((event) => `[${event.id}] ${event.timestamp} ${event.agent}: ${event.text}`).join('\n');
        await runtime.client.extract(text, `Cognitive ${scenario.scenario_id} batch${i + 1}`, {
          timestamp: group.at(-1).timestamp,
          sessionId: `${ordinal}-${i + 1}`,
          evaluationMode: true,
        });
        extractionCalls++;
        extractionCharacters += text.length;
      }
      await runtime.client.rebuildEmbeddings();
      await runtime.client.preflight();
      const retrievalStart = Date.now();
      const retrieval = await runtime.client.unifiedMemorySearch(scenario.question, this.config.full_omni.top_k);
      const retrievalLatency = Date.now() - retrievalStart;
      const contextItems = (retrieval.finalContext || retrieval.evidence || retrieval.results || []).slice(0, this.config.full_omni.top_k).map((item, index) => ({
        source_id: item.evidence_id || item.id || `omni-${index + 1}`,
        text: item.passage || item.fact || item.description || JSON.stringify(item),
        source: 'full_omni',
      }));
      return {
        contextItems,
        diagnostics: {
          extraction_calls: extractionCalls,
          extraction_input_characters: extractionCharacters,
          retrieval_calls: 1,
          reranker_calls: 1,
          retrieval_latency_ms: retrievalLatency,
          runtime_startup_and_ingestion_ms: Date.now() - started,
          search_methods: retrieval.searchMethods || {},
        },
        runtime,
      };
    } catch (error) {
      await runtime.stop().catch(() => {});
      throw error;
    }
  }
}

export function syntheticOracleAnswer(scenario) {
  const facts = (scenario.gold.required_facts || []).map((value, index) => ({
    key: `required_${index + 1}`,
    value,
    state: scenario.gold.current_facts?.includes(value) ? 'current' : scenario.gold.historical_facts?.includes(value) ? 'historical' : 'supported',
    source_ids: [scenario.events[index % scenario.events.length].id],
  }));
  return {
    answer: `Synthetic harness calibration for ${scenario.scenario_id}: ${(scenario.gold.required_facts || []).join('; ')}. Previous and current states are distinguished where required.`,
    facts,
    constraints_used: scenario.gold.required_constraints || [],
    rejected_facts: [...(scenario.gold.invalidated_facts || []), ...(scenario.gold.suppress || [])],
    insights: scenario.gold.acceptable_insights?.slice(0, 1) || [],
    actions: scenario.gold.acceptable_actions?.slice(0, 1) || [],
    uncertainty: null,
  };
}
