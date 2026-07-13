/**
 * Real LLM client for the benchmark runner.
 * Handles answer generation and judge evaluation via OpenAI-compatible API.
 *
 * Env vars:
 * - LLM_API_URL: Base URL (e.g., https://api.deepseek.com/v1)
 * - LLM_API_KEY: API key
 * - LLM_MODEL / ANSWER_MODEL: Model for answer generation
 * - JUDGE_MODEL: Model for judge evaluation (optional, defaults to answer model)
 * - JUDGE_API_URL: Optional separate URL for judge model
 * - JUDGE_API_KEY: Optional separate key for judge model
 */

export class LLMClient {
  constructor(options = {}) {
    const answerApiUrl = options.answerApiUrl || process.env.LLM_API_URL || '';
    const answerApiKey = options.answerApiKey || process.env.LLM_API_KEY || '';
    const answerModel = options.answerModel || process.env.ANSWER_MODEL || process.env.LLM_MODEL || '';

    if (!answerApiUrl) {
      throw new Error('LLM_API_URL is required for the benchmark runner. Set it to your OpenAI-compatible API base URL.');
    }
    if (!answerModel) {
      throw new Error('ANSWER_MODEL or LLM_MODEL is required for the benchmark runner.');
    }

    this.answerConfig = { apiUrl: answerApiUrl, apiKey: answerApiKey, model: answerModel };
    this.judgeConfig = {
      apiUrl: options.judgeApiUrl || process.env.JUDGE_API_URL || answerApiUrl,
      apiKey: options.judgeApiKey || process.env.JUDGE_API_KEY || answerApiKey,
      model: options.judgeModel || process.env.JUDGE_MODEL || answerModel,
    };
  }

  async chat({ apiUrl, apiKey, model, messages, temperature, maxTokens, responseFormat, timeoutMs = 60_000 }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: temperature ?? 0.3,
          max_tokens: maxTokens ?? 1024,
          ...(responseFormat ? { response_format: responseFormat } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`LLM API ${res.status}: ${text.slice(0, 500)}`);
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        throw new Error('LLM returned empty content');
      }
      return content.trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Generate an answer using retrieval results as context.
   * @param {string} question - The question to answer
   * @param {object} retrieval - Retrieval results from BrainServerClient.unifiedMemorySearch
   * @param {string} prompt - The system prompt
   * @returns {Promise<{answer: string, latencyMs: number}>}
   */
  async answer(question, retrieval, prompt) {
    const evidence = retrieval?.evidence || [];
    const context = evidence.length > 0 ? JSON.stringify(evidence, null, 2) : '[]';

    const messages = [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `## Evidence\n${context}\n\n## Temporal Query\n${JSON.stringify(retrieval?.temporalQuery || { mode: 'current', as_of: null })}\n\n## Question\n${question}\n\n## Instructions\nReturn only the strict JSON object required by the system prompt. Every evidence_ids entry must be copied exactly from the Evidence list.`,
      },
    ];

    const start = Date.now();
    const rawAnswerResponse = await this.chat({
      ...this.answerConfig,
      messages,
      temperature: 0.3,
      maxTokens: 1024,
      responseFormat: { type: 'json_object' },
    });
    const latencyMs = Date.now() - start;
    const cleaned = rawAnswerResponse.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g, '$1').trim();
    let structuredAnswer;
    try {
      structuredAnswer = JSON.parse(cleaned);
    } catch (parseErr) {
      throw new Error(`Answer output is not valid JSON: ${parseErr.message}\nRaw: ${cleaned.slice(0, 300)}`);
    }
    return { answer: structuredAnswer.answer, structuredAnswer, rawAnswerResponse, latencyMs };
  }

  /**
   * Judge a candidate answer against a reference answer.
   * @param {object} input - { question, reference_answer, candidate_answer, evidence, subset }
   * @param {string} prompt - The judge system prompt
   * @returns {Promise<{metrics: object, latencyMs: number}>}
   */
  async judge(input, prompt) {
    const messages = [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: JSON.stringify({
          question: input.question,
          reference_answer: input.reference_answer,
          structured_answer: input.structured_answer,
          evidence: input.evidence,
          reference_evidence: input.reference_evidence,
          temporal_query: input.temporal_query,
          subset: input.subset,
          answerable: input.answerable,
          adversarial: input.adversarial,
        }, null, 2),
      },
    ];

    const start = Date.now();
    const raw = await this.chat({
      ...this.judgeConfig,
      messages,
      temperature: 0.0,
      maxTokens: 1024,
      responseFormat: { type: 'json_object' },
    });
    const latencyMs = Date.now() - start;

    // Strip markdown code blocks if present
    const cleaned = raw.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?```/g, '$1').trim();
    let metrics;
    try {
      metrics = JSON.parse(cleaned);
    } catch (parseErr) {
      throw new Error(`Judge output is not valid JSON: ${parseErr.message}\nRaw: ${cleaned.slice(0, 300)}`);
    }
    return { metrics, latencyMs, rawJudgeResponse: raw };
  }
}
