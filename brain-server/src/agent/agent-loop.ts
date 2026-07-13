import { Database } from '../db/sqlite.js';
import { Entity } from '../shared-types.js';
import { MemoryDecayScheduler } from '../memory/decay-scheduler.js';
import { generateGraphInsights, GraphInsight } from './graph-insight.js';
import { detectBlindspots } from './blindspot-detector.js';
import { createAuditedAiFetch } from '../security/audited-ai-fetch.js';

const agentLlmFetch = createAuditedAiFetch({ purpose: 'proactive.agent-loop', kind: 'llm' });

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

  async generateInsight(
    nodes: Entity[],
    cycleSignal?: AbortSignal,
  ): Promise<{ ok: boolean; insight: { title: string; content: string } | null }> {
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
      // Task 12: Chain the cycle signal so stop() cancels this fetch.
      const onCycleAbort = () => controller.abort();
      if (cycleSignal) {
        if (cycleSignal.aborted) controller.abort();
        else cycleSignal.addEventListener('abort', onCycleAbort, { once: true });
      }

      try {
        const response = await agentLlmFetch(`${this.config.apiUrl}/chat/completions`, {
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
      } finally {
        clearTimeout(timeout);
        if (cycleSignal) cycleSignal.removeEventListener('abort', onCycleAbort);
      }
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
  private isCycleRunning = false;
  private skippedCycleCount = 0;
  private cycleTimeoutMs = 4 * 60 * 1000;
  private activeCycleToken: symbol | null = null;
  private static readonly DECAY_CHECK_INTERVAL = 6;
  private static readonly BLINDSPOT_CHECK_INTERVAL = 10;
  // Task 12: Cycle-level AbortController. stop() aborts this to cancel any
  // in-flight LLM calls instead of letting them run for up to 4 minutes after
  // the engine has been "stopped". Cleared in runCycle's finally block.
  private cycleAbort: AbortController | null = null;

  constructor(
    db: Database,
    decayScheduler?: MemoryDecayScheduler,
    options: { cycleTimeoutMs?: number } = {},
  ) {
    this.db = db;
    this.generator = new InsightGenerator();
    this.decayScheduler = decayScheduler || null;
    if (options.cycleTimeoutMs !== undefined) {
      if (!Number.isFinite(options.cycleTimeoutMs) || options.cycleTimeoutMs <= 0) {
        throw new Error('cycleTimeoutMs must be a positive finite number');
      }
      this.cycleTimeoutMs = options.cycleTimeoutMs;
    }
  }

  start(intervalMs: number = 60000) {
    if (this.interval) return;
    console.log(`[AgentLoop] 启动主动智能引擎，周期: ${intervalMs}ms`);

    this.warmupTimer = setTimeout(() => {
      this.warmupTimer = null;
      this.runCycle();
    }, 5000);

    this.interval = setInterval(() => {
      if (this.isCycleRunning) {
        this.skippedCycleCount++;
        return;
      }
      this.runCycle()
    }, intervalMs);
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
    }
    // Task 12: Abort any in-flight cycle. This cancels pending LLM fetches
    // (polishInsightWithLLM and InsightGenerator.generateInsight) via the
    // signal they consume. DB queries are not abortable but are fast; the
    // LLM calls are the long pole. The cycle's finally block will still run
    // to release isCycleRunning and clear cycleAbort.
    if (this.cycleAbort) {
      console.log('[AgentLoop] 中止进行中的周期任务');
      this.cycleAbort.abort();
      // Do NOT null cycleAbort here — the runCycle finally block owns that.
    }
    console.log('[AgentLoop] 已停止主动智能引擎');
  }

  isRunning(): boolean {
    return this.interval !== null || this.warmupTimer !== null;
  }

  /**
   * 对非 statistical 类型的图分析候选洞见，用 LLM 润色标题和内容。
   * LLM 失败时降级到模板原文。
   *
   * Task 12: Now accepts an optional cycleSignal so that stop() can cancel
   * the in-flight LLM call via the cycle-level AbortController. The local
   * timeout AbortController is chained to the cycle signal so that aborting
   * either one cancels the fetch.
   */
  private async polishInsightWithLLM(
    insight: GraphInsight,
    cycleSignal?: AbortSignal,
  ): Promise<{ title: string; content: string }> {
    try {
      const config = this.generator.getConfig();
      if (!config.apiUrl) throw new Error('LLM not configured');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      // Task 12: Chain the cycle signal so stop() cancels this fetch.
      const onCycleAbort = () => controller.abort();
      if (cycleSignal) {
        if (cycleSignal.aborted) controller.abort();
        else cycleSignal.addEventListener('abort', onCycleAbort, { once: true });
      }

      try {
        const response = await agentLlmFetch(`${config.apiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: '你是一个知识发现助理。将数据发现改写成简洁优雅的洞见陈述。只输出有效的 JSON。' },
              { role: 'user', content: `将以下数据发现改写成一条简洁的洞见，保留关键信息但用更自然的语言表达：\n标题: ${insight.title}\n内容: ${insight.content}\n类别: ${insight.category}\n\n请严格按照以下 JSON 格式输出：\n{"title": "润色后的标题", "content": "润色后的内容"}` },
            ],
            max_tokens: config.maxTokens,
            temperature: 0.5,
            response_format: { type: 'json_object' },
          }),
          signal: controller.signal,
        });

        if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);

        const data = await response.json() as { choices: Array<{ message: { content: string } }> };
        const text = data.choices?.[0]?.message?.content;
        if (!text) throw new Error('Empty LLM response');

        const parsed = JSON.parse(text.trim());
        if (parsed.title && parsed.content) {
          return { title: parsed.title, content: parsed.content };
        }
        throw new Error('Invalid LLM JSON shape');
      } finally {
        clearTimeout(timeout);
        if (cycleSignal) cycleSignal.removeEventListener('abort', onCycleAbort);
      }
    } catch (e) {
      console.warn('[AgentLoop] LLM 润色失败，降级到模板输出:', e);
      // 降级：直接使用图分析的原始模板文本
      return { title: insight.title, content: insight.content };
    }
  }

  private async runCycle() {
    // Concurrency guard: only one cycle at a time
    if (this.isCycleRunning) {
      this.skippedCycleCount++;
      return;
    }
    this.isCycleRunning = true;
    const cycleToken = Symbol('agent-cycle');
    this.activeCycleToken = cycleToken;
    this.lastCycleStart = new Date();
    console.log('[AgentLoop] 唤醒，执行周期任务...');
    const cycle = this.cycleCount++;

    // Task 12: Create a cycle-level AbortController so stop() can cancel
    // any in-flight LLM calls. The signal is passed down to polishInsightWithLLM
    // and InsightGenerator.generateInsight, which chain it to their own timeout
    // controllers.
    const cycleController = new AbortController();
    this.cycleAbort = cycleController;
    const cycleSignal = cycleController.signal;

    // Timeout guard: force-release the lock if a cycle runs too long.
    // Also abort the cycle controller so any pending LLM fetch is cancelled.
    const cycleTimeout = setTimeout(() => {
      if (this.activeCycleToken === cycleToken) {
        console.warn('[AgentLoop] Cycle timeout — force-releasing lock');
        cycleController.abort();
        this.activeCycleToken = null;
        if (this.cycleAbort === cycleController) this.cycleAbort = null;
        this.isCycleRunning = false;
        this.lastError = new Error('Cycle timeout');
        this.lastCycleEnd = new Date();
      }
    }, this.cycleTimeoutMs);

    try {
      try {
        // insight_generation / consolidation 独立任务
        const batch = await this.db.getEntitiesForConsolidation(5);
        // A timed-out cycle may resume if a non-abortable DB promise settles
        // later. The token prevents that stale continuation from mutating data
        // or releasing the lock held by a newer cycle.
        if (this.activeCycleToken !== cycleToken || cycleSignal.aborted) return;

        if (batch.length < 2) {
          console.log('[AgentLoop] 洞见数据不足，本轮仅跳过 insight_generation');
        } else {

      // 2. 图分析驱动：优先使用 generateGraphInsights
      let result: { ok: boolean; insight: { title: string; content: string } | null } = { ok: false, insight: null };
      let insightRelatedEntities: string[] = batch.map(e => e.id);
      let selectedGraphInsight: GraphInsight | undefined;

      try {
        const candidates = await generateGraphInsights(this.db, batch);

        if (candidates.length > 0) {
          // 选取置信度最高的候选
          const best = candidates[0]; // 已按 confidence 降序排列
          selectedGraphInsight = best;

          if (best.category === 'statistical') {
            // statistical 类型不调 LLM，直接使用模板输出
            result = { ok: true, insight: { title: best.title, content: best.content } };
          } else {
            // latent_connection / anti_consensus 类型通过 LLM 润色
            const polished = await this.polishInsightWithLLM(best, cycleSignal);
            result = { ok: true, insight: polished };
          }

          // 使用洞见自身的 related_entities（如果有的话）
          if (best.related_entities.length > 0) {
            insightRelatedEntities = best.related_entities;
          }

          console.log(`[AgentLoop] 图分析产出 ${candidates.length} 个候选，选中: [${best.category}] ${best.title}`);
        }
      } catch (e) {
        console.warn('[AgentLoop] 图分析洞见生成失败，将 fallback 到旧逻辑:', e);
      }

      // 3. Fallback：当图分析未产出候选时，回退到旧的 LLM 直接生成逻辑
      if (!result.insight) {
        console.log('[AgentLoop] 图分析无候选，fallback 到 LLM 直接生成');
        result = await this.generator.generateInsight(batch, cycleSignal);
      }

      if (result.ok) {
        await this.db.markEntitiesConsolidated(batch.map(e => e.id));
      }

          if (result.insight) {
        // Task 12: Dedup guard — skip if an insight with the same title was
        // already created in the last 24h. The 7-day cooldownUntil recorded in
        // proactive_insights was never queried before creating a new insight,
        // so the same insight could fire every cycle.
        if (await this.db.hasRecentNotification(result.insight.title, 1)) {
          console.log(`[AgentLoop] 跳过重复洞见通知: ${result.insight.title}`);
        } else {
        const notification = await this.db.addNotification({
          title: result.insight.title,
          content: result.insight.content,
          type: 'insight',
          related_entities: insightRelatedEntities,
        });
        const generatedAt = new Date();
        const cooldownUntil = new Date(generatedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await this.db.recordProactiveInsight({
          notificationId: notification.id,
          insightType: selectedGraphInsight?.category || 'llm_fallback',
          trigger: selectedGraphInsight ? 'graph_analysis' : 'consolidation_batch',
          evidenceIds: insightRelatedEntities,
          confidence: selectedGraphInsight?.confidence ?? 0.5,
          reason: selectedGraphInsight?.content || 'LLM fallback over consolidation candidates',
          cooldownUntil,
        });
        console.log(`[AgentLoop] 产生新洞见: ${result.insight.title}`);
        } // end of dedup else
          } else {
            console.log('[AgentLoop] 本轮未产生有效洞见');
          }
        }
      } catch (e) {
        console.warn('[AgentLoop] insight_generation 失败，继续其他周期任务:', e);
      }

      // Decision review is an independent deterministic task. It does not call an LLM
      // and never changes principles from a single observed result.
      try {
        const dueDecisions = await this.db.all<{ id: string; name: string }>(
          `SELECT id, name FROM entities
           WHERE type = 'decision'
             AND json_extract(metadata, '$.revisit_at') IS NOT NULL
             AND json_extract(metadata, '$.revisit_at') <= ?
             AND json_array_length(COALESCE(json_extract(metadata, '$.outcomes'), '[]')) = 0
           ORDER BY json_extract(metadata, '$.revisit_at') ASC
           LIMIT 10`,
          [new Date().toISOString()],
        );
        for (const decision of dueDecisions) {
          const title = 'Decision review due';
          if (await this.db.hasRecentNotification(title, 30, decision.id)) continue;
          await this.db.addNotification({
            title,
            content: `Review the outcome, failed assumptions, unexpected factors, and lessons for decision ${decision.id}: ${decision.name}`,
            type: 'reminder',
            related_entities: [decision.id],
          });
        }
      } catch (error) {
        console.warn('[AgentLoop] decision_review_reminder failed, continuing:', error);
      }

      // 4. 每 N 轮检查一次记忆衰减，生成 decay_warning 通知
      if (this.decayScheduler && cycle % AgentLoop.DECAY_CHECK_INTERVAL === 0) {
        try {
          const decayed = await this.decayScheduler.getMostDecayedItems(5);
          if (decayed.length > 0) {
            // Task 12: Dedup guard — skip if a decay_warning was already created
            // in the last 24h. Without this, a new notification fires every
            // DECAY_CHECK_INTERVAL cycles (~6 min) as long as the same items
            // remain decayed.
            if (await this.db.hasRecentNotification('记忆衰减预警', 1)) {
              console.log('[AgentLoop] 跳过重复衰减预警通知');
            } else {
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
          }
        } catch (e) {
          console.warn('[AgentLoop] 衰减分析失败，跳过:', e);
        }
      }

      // 5. 每 N 轮检查一次认知盲区
      if (cycle % AgentLoop.BLINDSPOT_CHECK_INTERVAL === 0) {
        try {
          const blindspots = await detectBlindspots(this.db);
          for (const bs of blindspots) {
            // Task 12: Belt-and-suspenders dedup — the detector has its own
            // 24h per-entity-set dedup, but if the detector's title-text
            // inference breaks or related_entities changes, this guard still
            // prevents duplicate notifications with the same title.
            if (await this.db.hasRecentNotification(bs.title, 1)) {
              console.log(`[AgentLoop] 跳过重复盲区通知: ${bs.title}`);
              continue;
            }
            const notification = await this.db.addNotification({
              title: bs.title,
              content: bs.content,
              type: 'blindspot',
              related_entities: bs.related_entities,
            });
            await this.db.recordProactiveInsight({
              notificationId: notification.id,
              insightType: bs.type,
              trigger: 'behavior_blindspot_detection',
              evidenceIds: bs.related_entities,
              confidence: bs.confidence,
              reason: bs.content,
              cooldownUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            });
          }
          if (blindspots.length > 0) {
            console.log(`[AgentLoop] 发现 ${blindspots.length} 个认知盲区`);
          }
        } catch (e) {
          console.warn('[AgentLoop] 盲区检测失败，跳过:', e);
        }
      }
    } catch (error) {
      console.error('[AgentLoop] 执行周期异常:', error);
      this.lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(cycleTimeout);
      // Task 12: Clear the cycle AbortController. If stop() was called during
      // this cycle, the controller was already aborted — we just drop the
      // reference so the next cycle gets a fresh one.
      if (this.activeCycleToken === cycleToken) {
        this.activeCycleToken = null;
        if (this.cycleAbort === cycleController) this.cycleAbort = null;
        this.isCycleRunning = false;
        this.lastCycleEnd = new Date();
      }
    }
  }

  /** Expose lifecycle status for monitoring */
  getStatus() {
    return {
      running: this.isCycleRunning,
      cycleCount: this.cycleCount,
      skippedCount: this.skippedCycleCount,
      lastCycleStart: this.lastCycleStart,
      lastCycleEnd: this.lastCycleEnd,
      lastError: this.lastError,
    };
  }

  private lastCycleStart: Date | null = null;
  private lastCycleEnd: Date | null = null;
  private lastError: Error | null = null;
}
