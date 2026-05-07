import { Database } from '../db/sqlite.js';
import { Entity } from '../shared-types.js';

interface LLMInsightConfig {
  apiUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
}

const DEFAULT_LLM_CONFIG: LLMInsightConfig = {
  apiUrl: process.env.LLM_API_URL || 'http://localhost:11434/v1',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'qwen2.5:7b',
  timeoutMs: 30_000,
  maxTokens: 512,
};

class InsightGenerator {
  private config: LLMInsightConfig;

  constructor(config: Partial<LLMInsightConfig> = {}) {
    this.config = { ...DEFAULT_LLM_CONFIG, ...config };
  }

  async generateInsight(nodes: Entity[]): Promise<{ title: string; content: string } | null> {
    if (!this.config.apiUrl || nodes.length < 2) return null;

    const contextText = nodes.map(n => `- [${n.type}] ${n.name}: ${n.description}`).join('\n');
    const prompt = `你是一个知识图谱分析专家。以下是用户最近访问或添加的知识节点：\n${contextText}\n
请找出这些节点之间隐藏的深刻联系或模式，并提出一个有启发的“洞见(Insight)”。
请严格按照以下 JSON 格式输出，不要添加任何其他文字：
{
  "title": "洞见标题",
  "content": "洞见详细内容"
}`;

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
              content: '你是一个知识发现助理。只输出有效的 JSON。',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          max_tokens: this.config.maxTokens,
          temperature: 0.7,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) return null;

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;

      const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      const parsed = JSON.parse(jsonStr.trim());

      if (parsed.title && parsed.content) {
        return { title: parsed.title, content: parsed.content };
      }
      return null;
    } catch (e) {
      console.warn('[AgentLoop] 洞见生成失败:', e);
      return null;
    }
  }
}

export class AgentLoop {
  private db: Database;
  private interval: NodeJS.Timeout | null = null;
  private warmupTimer: NodeJS.Timeout | null = null;
  private generator: InsightGenerator;
  // 同一组 entity 不重复生成洞见，避免在没有新数据时反复刷屏
  private lastAnchorKey: string | null = null;
  private lastAnchorAt: number = 0;
  // 即使 anchor 不变，超过该窗口仍允许重新触发一次分析
  private readonly anchorRefreshMs = 30 * 60 * 1000;

  constructor(db: Database) {
    this.db = db;
    this.generator = new InsightGenerator();
  }

  start(intervalMs: number = 60000) {
    if (this.interval) return;
    console.log(`[AgentLoop] 启动主动智能引擎，周期: ${intervalMs}ms`);

    this.warmupTimer = setTimeout(() => {
      this.warmupTimer = null;
      this.runCycle();
    }, 5000);

    this.interval = setInterval(() => this.runCycle(), intervalMs);
  }

  stop() {
    if (this.warmupTimer) {
      clearTimeout(this.warmupTimer);
      this.warmupTimer = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[AgentLoop] 已停止主动智能引擎');
    }
  }

  private async runCycle() {
    console.log('[AgentLoop] 唤醒，执行周期任务...');
    try {
      // 1. 获取最近更新的节点作为锚点 (Fallback for testing: get any principles or memories)
      const recentEntities = await this.db.all<Entity>(
        'SELECT * FROM entities ORDER BY updated_at DESC LIMIT 5'
      );

      if (recentEntities.length < 2) {
        console.log('[AgentLoop] 数据不足，跳过本轮分析');
        return;
      }

      // 2. 去重：相同的最近实体集合 + 短窗口内不重复生成洞见
      const anchorKey = recentEntities
        .map(e => e.id)
        .sort()
        .join('|');
      const now = Date.now();
      if (
        this.lastAnchorKey === anchorKey &&
        now - this.lastAnchorAt < this.anchorRefreshMs
      ) {
        console.log('[AgentLoop] 锚点未变化，跳过 LLM 调用');
        return;
      }

      // 3. 生成洞见
      const insight = await this.generator.generateInsight(recentEntities);
      this.lastAnchorKey = anchorKey;
      this.lastAnchorAt = now;
      if (insight) {
        await this.db.addNotification({
          title: insight.title,
          content: insight.content,
          type: 'insight',
          related_entities: recentEntities.map(e => e.id),
        });
        console.log(`[AgentLoop] 产生新洞见: ${insight.title}`);
      } else {
        console.log('[AgentLoop] 本轮未产生有效洞见');
      }
    } catch (error) {
      console.error('[AgentLoop] 执行周期异常:', error);
    }
  }
}
