/**
 * [核心壁垒] LLM 驱动的知识图谱提取管道
 * 
 * 功能：
 * 1. 通过 LLM 将非结构化文本转化为结构化的实体和关系
 * 2. 支持多 LLM 后端（OpenAI 兼容 API / Ollama 本地）
 * 3. 作为正则提取的增强层 — 正则先跑，LLM 补充语义理解
 * 
 * 设计原则：可插拔，优雅降级
 */

export interface LLMExtractionConfig {
  /** API 基础 URL（兼容 OpenAI 格式） */
  apiUrl: string;
  /** API Key（本地 Ollama 不需要） */
  apiKey?: string;
  /** 模型名称 */
  model: string;
  /** 提取超时（ms） */
  timeoutMs: number;
  /** 最大 token 数 */
  maxTokens: number;
}

const DEFAULT_LLM_CONFIG: LLMExtractionConfig = {
  apiUrl: process.env.LLM_API_URL || 'http://localhost:11434/v1',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'qwen2.5:7b',
  timeoutMs: 30_000,
  maxTokens: 2048,
};

/** LLM 输出的结构化提取结果 */
interface LLMExtractionResult {
  entities: Array<{
    name: string;
    type: string;
    description: string;
  }>;
  relationships: Array<{
    source: string;
    target: string;
    type: string;
    description: string;
  }>;
  principles: Array<{
    title: string;
    content: string;
    type: string;
    isCore: boolean;
  }>;
}

const EXTRACTION_PROMPT = `你是一个知识图谱提取专家。请从以下文本中提取结构化知识。

请严格按照以下 JSON 格式输出（不要添加任何其他文字）：
{
  "entities": [
    {"name": "实体名", "type": "类型", "description": "描述"}
  ],
  "relationships": [
    {"source": "源实体名", "target": "目标实体名", "type": "关系类型", "description": "描述"}
  ],
  "principles": [
    {"title": "标题", "content": "内容", "type": "类型", "isCore": false}
  ]
}

实体类型可选：principle, code_snippet, evidence, concept, tool, security_rule, performance_optimization, architecture_pattern, bug_vulnerability, business_logic, person, project
关系类型可选：extends, depends_on, relates_to, conflicts_with, derived_from, belongs_to, supported_by, extracted_from
原则类型可选：code_principle, security_rule, performance_optimization, design_pattern, workflow_rule, personal_preference

要求：
1. 只提取有意义的实体，忽略噪音
2. 关系的 source 和 target 必须是你提取的实体名
3. 如果文本中包含明确的规则/原则/最佳实践，提取为 principles
4. 如果没有可提取的内容，返回空数组

文本内容：
`;

export class LLMExtractorPipeline {
  private config: LLMExtractionConfig;
  private enabled: boolean = true;

  constructor(config: Partial<LLMExtractionConfig> = {}) {
    this.config = { ...DEFAULT_LLM_CONFIG, ...config };

    // 如果没有配置 API URL，禁用 LLM 提取
    if (!this.config.apiUrl) {
      this.enabled = false;
      console.log('[LLMExtractor] 未配置 API URL，LLM 提取已禁用');
    }
  }

  /**
   * 通过 LLM 提取结构化知识
   * @param text 原始文本
   * @returns 提取结果，失败时返回空结果
   */
  async extract(text: string): Promise<LLMExtractionResult> {
    if (!this.enabled) return this._emptyResult();

    // 截断过长文本（避免 token 超限）
    const truncated = text.length > 4000 ? text.slice(0, 4000) + '\n...[截断]' : text;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(`${this.config.apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            {
              role: 'system',
              content: '你是一个知识图谱提取专家，只输出有效的 JSON，不添加任何其他文字。',
            },
            {
              role: 'user',
              content: EXTRACTION_PROMPT + truncated,
            },
          ],
          max_tokens: this.config.maxTokens,
          temperature: 0.1, // 低温度确保输出稳定
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.warn(`[LLMExtractor] API 返回 ${response.status}: ${response.statusText}`);
        return this._emptyResult();
      }

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        console.warn('[LLMExtractor] API 返回空内容');
        return this._emptyResult();
      }

      return this._parseResult(content);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        console.warn(`[LLMExtractor] 请求超时 (${this.config.timeoutMs}ms)`);
      } else {
        console.warn('[LLMExtractor] 提取失败:', e);
      }
      return this._emptyResult();
    }
  }

  /**
   * 解析 LLM 输出的 JSON
   */
  private _parseResult(content: string): LLMExtractionResult {
    try {
      // 尝试从 markdown code block 中提取 JSON
      const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;

      const parsed = JSON.parse(jsonStr.trim());

      // 验证结构完整性
      return {
        entities: Array.isArray(parsed.entities) ? parsed.entities.filter(
          (e: any) => e.name && e.type
        ) : [],
        relationships: Array.isArray(parsed.relationships) ? parsed.relationships.filter(
          (r: any) => r.source && r.target && r.type
        ) : [],
        principles: Array.isArray(parsed.principles) ? parsed.principles.filter(
          (p: any) => p.title && p.content
        ) : [],
      };
    } catch (e) {
      console.warn('[LLMExtractor] JSON 解析失败:', e);
      return this._emptyResult();
    }
  }

  /**
   * 检查 LLM 服务是否可用
   */
  async healthCheck(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.config.apiUrl}/models`, {
        signal: controller.signal,
        headers: this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {},
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private _emptyResult(): LLMExtractionResult {
    return { entities: [], relationships: [], principles: [] };
  }
}
