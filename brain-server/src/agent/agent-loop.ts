import { Database } from '../db/sqlite.js';
import { Entity } from '../shared-types.js';
import { MemoryDecayScheduler } from '../memory/decay-scheduler.js';

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

  setConfig(config: Partial<LLMInsightConfig>) {
    this.config = { ...this.config, ...config };
  }

  getConfig(): LLMInsightConfig {
    return { ...this.config };
  }

  async generateInsight(nodes: Entity[]): Promise<{ ok: boolean; insight: { title: string; content: string } | null }> {
    if (!this.config.apiUrl) return { ok: false, insight: null };
    if (nodes.length < 2) return { ok: true, insight: null };

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

      if (!response.ok) return { ok: false, insight: null };

      const data = await response.json() as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('LLM response content is empty');
      }

      const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      
      let parsed: any;
      try {
        parsed = JSON.parse(jsonStr.trim());
      } catch (e) {
        const balanced = (() => {
          const start = jsonStr.indexOf('{');
          if (start === -1) return null;
          let count = 0;
          for (let i = start; i < jsonStr.length; i++) {
            if (jsonStr[i] === '{') {
              count++;
            } else if (jsonStr[i] === '}') {
              count--;
              if (count === 0) return jsonStr.substring(start, i + 1);
            }
          }
          return null;
        })();
        if (balanced) {
          parsed = JSON.parse(balanced);
        } else {
          throw e;
        }
      }

      if (parsed.title && parsed.content) {
        return { ok: true, insight: { title: parsed.title, content: parsed.content } };
      }
      return { ok: true, insight: null };
    } catch (e) {
      console.warn('[AgentLoop] 洞见生成失败:', e);
      return { ok: false, insight: null };
    }
  }
}

export class AgentLoop {
  private db: Database;
  private interval: NodeJS.Timeout | null = null;
  private warmupTimer: NodeJS.Timeout | null = null;
  private generator: InsightGenerator;
  private decayScheduler: MemoryDecayScheduler | null = null;
  // 衰减洞见每 6 轮（约 6 分钟）触发一次
  private cycleCount = 0;
  private static readonly DECAY_CHECK_INTERVAL = 6;

  constructor(db: Database, decayScheduler?: MemoryDecayScheduler) {
    this.db = db;
    this.generator = new InsightGenerator();
    this.decayScheduler = decayScheduler || null;
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

  setLlmConfig(config: { apiUrl: string; apiKey?: string; model: string }) {
    this.generator.setConfig({
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      model: config.model,
    });
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

  isRunning(): boolean {
    return this.interval !== null || this.warmupTimer !== null;
  }

  private async runCycle() {
    console.log('[AgentLoop] 唤醒，执行周期任务...');
    try {
      // 1. 获取未整合或更新待重整合的节点
      const batch = await this.db.getEntitiesForConsolidation(5);

      if (batch.length < 2) {
        console.log('[AgentLoop] 数据不足，跳过本轮分析');
        return;
      }

      // 2. 生成洞见
      const result = await this.generator.generateInsight(batch);
      if (result.ok) {
        await this.db.markEntitiesConsolidated(batch.map(e => e.id));
      }

      if (result.insight) {
        await this.db.addNotification({
          title: result.insight.title,
          content: result.insight.content,
          type: 'insight',
          related_entities: batch.map(e => e.id),
        });
        console.log(`[AgentLoop] 产生新洞见: ${result.insight.title}`);
      } else {
        console.log('[AgentLoop] 本轮未产生有效洞见');
      }

      // 4. 每 N 轮检查一次记忆衰减，生成 decay_warning 通知
      this.cycleCount++;
      if (this.decayScheduler && this.cycleCount % AgentLoop.DECAY_CHECK_INTERVAL === 0) {
        try {
          const decayed = await this.decayScheduler.getMostDecayedItems(5);
          if (decayed.length > 0) {
            const names = decayed.map((d) => {
              const daysAgo = Math.round((Date.now() - new Date(d.last_accessed).getTime()) / (1000 * 60 * 60 * 24));
              return `- **${d.name}** (${d.type}) — ${daysAgo} 天未访问`;
            }).join('\n');
            await this.db.addNotification({
              title: '记忆衰减预警',
              content: `以下记忆已超过 7 天未访问，可能值得回顾：\n\n${names}`,
              type: 'decay_warning',
              related_entities: decayed.map((d) => d.id),
            });
            console.log(`[AgentLoop] 产生衰减预警: ${decayed.length} 条`);
          }
        } catch (e) {
          console.warn('[AgentLoop] 衰减分析失败，跳过:', e);
        }
      }
    } catch (error) {
      console.error('[AgentLoop] 执行周期异常:', error);
    }
  }
}
