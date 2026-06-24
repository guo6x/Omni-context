/**
 * [核心壁垒] 记忆衰减调度器
 * 
 * 模拟人类记忆的艾宾浩斯遗忘曲线：
 * - 频繁访问的记忆保持强连接
 * - 长期未访问的关系权重逐渐降低
 * - 极低权重的关系最终被归档或软删除
 * 
 * 衰减公式: weight_new = weight * decay_factor ^ (days_since_last_access)
 */

import { Database } from '../db/sqlite.js';

export interface DecayConfig {
  /** 衰减因子 (0~1)，越小衰减越快。默认 0.95 = 每天衰减 5% */
  decayFactor: number;
  /** 最低权重阈值，低于此值的关系将被标记为 dormant */
  minWeight: number;
  /** 实体最长未访问天数，超过则标记为 stale */
  staleDays: number;
  /** 调度间隔（毫秒），默认 1 小时 */
  intervalMs: number;
  /** 是否自动启动 */
  autoStart: boolean;
}

const DEFAULT_CONFIG: DecayConfig = {
  decayFactor: 0.95,
  minWeight: 0.05,
  staleDays: 90,
  intervalMs: 60 * 60 * 1000, // 1 小时
  autoStart: true,
};

export interface DecayReport {
  /** 本次处理的关系数 */
  relationshipsProcessed: number;
  /** 被衰减的关系数 */
  relationshipsDecayed: number;
  /** 标记为 dormant 的关系数 */
  relationshipsDormant: number;
  /** 标记为 stale 的实体数 */
  entitiesStale: number;
  /** 执行耗时 (ms) */
  durationMs: number;
  /** 执行时间 */
  timestamp: string;
}

export class MemoryDecayScheduler {
  private db: Database;
  private config: DecayConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private warmupTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastReport: DecayReport | null = null;

  constructor(db: Database, config: Partial<DecayConfig> = {}) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoStart) {
      this.start();
    }
  }

  /**
   * 启动定时调度
   */
  start(): void {
    if (this.timer) return;
    console.log(`[MemoryDecay] 启动调度器 (间隔: ${this.config.intervalMs / 1000}s)`);

    // 首次延迟 10 秒执行（等待系统初始化）— 句柄保留，stop 时清理
    this.warmupTimer = setTimeout(() => {
      this.warmupTimer = null;
      this.runDecayCycle();
    }, 10_000);
    this.timer = setInterval(() => this.runDecayCycle(), this.config.intervalMs);
  }

  /**
   * 停止调度
   */
  stop(): void {
    if (this.warmupTimer) {
      clearTimeout(this.warmupTimer);
      this.warmupTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[MemoryDecay] 调度器已停止');
    }
  }

  /**
   * 手动触发一次衰减周期
   */
  async runDecayCycle(): Promise<DecayReport> {
    if (this.running) {
      console.warn('[MemoryDecay] 上一次衰减周期仍在运行，跳过');
      return this.lastReport || this._emptyReport();
    }

    this.running = true;
    const start = Date.now();

    try {
      const report: DecayReport = {
        relationshipsProcessed: 0,
        relationshipsDecayed: 0,
        relationshipsDormant: 0,
        entitiesStale: 0,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      };

      // 1. 衰减长期未激活的关系权重
      await this._decayRelationships(report);

      // 2. 标记长期未访问的实体为 stale
      await this._markStaleEntities(report);

      // 3. 强化最近活跃的高频关系
      await this._reinforceActiveRelationships();

      // 4. 睡眠巩固（约每日一次）：合并完全重复 + 生成整理报告
      await this._consolidate();

      report.durationMs = Date.now() - start;
      this.lastReport = report;

      if (report.relationshipsDecayed > 0 || report.entitiesStale > 0) {
        console.log(
          `[MemoryDecay] 周期完成: 衰减${report.relationshipsDecayed}条关系, ` +
          `休眠${report.relationshipsDormant}条, 过期实体${report.entitiesStale}个 ` +
          `(${report.durationMs}ms)`
        );
      }

      return report;
    } finally {
      this.running = false;
    }
  }

  /**
   * 获取最近一次衰减报告
   */
  getLastReport(): DecayReport | null {
    return this.lastReport;
  }

  /**
   * 获取衰减最严重的 N 条实体（7 天未访问 + 曾被访问过）
   */
  async getMostDecayedItems(limit: number = 5): Promise<Array<{ id: string; name: string; type: string; last_accessed: string; access_count: number }>> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = sevenDaysAgo.toISOString();

    const rows = await this.db.all<{
      id: string;
      name: string;
      type: string;
      last_accessed: string;
      access_count: number;
    }>(
      `SELECT id, name, type, last_accessed, access_count
       FROM entities
       WHERE last_accessed < ?
       AND access_count > 0
       ORDER BY last_accessed ASC, access_count DESC
       LIMIT ?`,
      [cutoff, limit]
    );

    return rows;
  }

  /**
   * 衰减关系权重 — 计算阶段先聚合需要更新的行，再用一次事务批量提交，
   * 避免在大型图谱上做 N 次独立 UPDATE 触发的 fsync 风暴。
   */
  private async _decayRelationships(report: DecayReport): Promise<void> {
    // 查找所有非 dormant 的关系
    const relationships = await this.db.all<{
      id: string;
      weight: number;
      last_activated: string;
    }>(`SELECT id, weight, last_activated FROM relationships WHERE weight > ?`, [
      this.config.minWeight,
    ]);

    report.relationshipsProcessed = relationships.length;
    const now = Date.now();
    const updates: Array<{ id: string; weight: number; dormant: boolean }> = [];

    for (const rel of relationships) {
      const lastActivated = new Date(rel.last_activated).getTime();
      const daysSince = (now - lastActivated) / (1000 * 60 * 60 * 24);

      if (daysSince < 1) continue;

      const newWeight = rel.weight * Math.pow(this.config.decayFactor, daysSince);
      if (newWeight <= this.config.minWeight) {
        updates.push({ id: rel.id, weight: this.config.minWeight, dormant: true });
      } else if (Math.abs(newWeight - rel.weight) > 0.001) {
        updates.push({ id: rel.id, weight: Math.round(newWeight * 1000) / 1000, dormant: false });
      }
    }

    if (updates.length === 0) return;

    await this.db.withTransaction(async () => {
      for (const u of updates) {
        await this.db.run('UPDATE relationships SET weight = ? WHERE id = ?', [u.weight, u.id]);
        if (u.dormant) report.relationshipsDormant++;
        else report.relationshipsDecayed++;
      }
    });
  }

  private async _markStaleEntities(report: DecayReport): Promise<void> {
    // 查找长期未访问且未标记为 stale 的实体（通过 importance 加权天数差）
    const staleEntities = await this.db.all<{ id: string }>(
      `SELECT id FROM entities
       WHERE (julianday('now') - julianday(last_accessed)) > (? * (0.5 + COALESCE(cast(json_extract(metadata, '$.importance') as real), 0.5)))
       AND (metadata IS NULL OR json_extract(metadata, '$.stale') IS NULL OR json_extract(metadata, '$.stale') = 0)`,
      [this.config.staleDays]
    );

    if (staleEntities.length === 0) return;

    const stamp = new Date().toISOString();
    await this.db.withTransaction(async () => {
      for (const entity of staleEntities) {
        try {
          await this.db.run(
            `UPDATE entities
             SET metadata = json_set(COALESCE(metadata, '{}'), '$.stale', 1, '$.stale_since', ?)
             WHERE id = ?`,
            [stamp, entity.id]
          );
          report.entitiesStale++;
        } catch {
          // 单个实体标记失败不影响整体
        }
      }
    });
  }

  /**
   * 强化活跃关系 — 赫布学习规则 "neurons that fire together wire together"
   * 最近 24h 内被访问的实体之间的关系获得微量增强
   */
  private async _reinforceActiveRelationships(): Promise<void> {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const cutoff = yesterday.toISOString();

    await this.db.run(
      `UPDATE relationships
       SET weight = MIN(weight * 1.01, 10.0)
       WHERE source_id IN (SELECT id FROM entities WHERE last_accessed > ?)
       AND target_id IN (SELECT id FROM entities WHERE last_accessed > ?)
       AND last_activated > ?`,
      [cutoff, cutoff, cutoff]
    );
  }

  /**
   * 睡眠巩固 — 模拟大脑睡眠时的整理：自动做高置信度的安全合并（完全同名同类型的重复），
   * 拿不准的（core 臃肿等）只生成报告交给用户，绝不擅自删除。约每 20h 跑一次。
   */
  private async _consolidate(): Promise<void> {
    try {
      const last = await this.db.getMeta('last_consolidate');
      if (last && Date.now() - new Date(last).getTime() < 20 * 60 * 60 * 1000) return;

      // a) 自动合并完全重复（高置信度、可逆软合并）
      const groups = await this.db.findExactDuplicateGroups();
      let merged = 0;
      const mergedNames: string[] = [];
      for (const g of groups) {
        const [keep, ...drops] = g.ids;
        for (const d of drops) {
          await this.db.softMergeEntities(keep, d);
          merged++;
        }
        if (drops.length) mergedNames.push(`${g.name}(${drops.length + 1}→1)`);
      }

      // b) 判断题只出报告，不动手
      const stats = await this.db.getStats();
      const coreCount = (stats as any).corePrinciples ?? 0;
      const lines: string[] = [];
      if (merged > 0) lines.push(`已自动合并 ${merged} 条完全重复：${mergedNames.slice(0, 8).join('、')}`);
      const shouldSuggestCoreReview = coreCount > 40
        && !(await this.db.hasRecentNotification('🌙 睡眠整理报告', 14, '核心原则'));
      if (shouldSuggestCoreReview) {
        lines.push(`核心原则 ${coreCount} 条偏多。点击“整理核心原则”可直接进入核心原则列表，把不够独特的条目降为普通原则；不会删除，之后仍可检索。`);
      }

      if (lines.length > 0) {
        try {
          await this.db.addNotification({
            title: shouldSuggestCoreReview
              ? '🌙 睡眠整理报告：核心原则待精简'
              : '🌙 睡眠整理报告',
            content: lines.join('\n'),
            type: 'consolidation',
            related_entities: [],
          } as any);
        } catch { /* 通知失败不影响 */ }
      }
      await this._proactive();
      await this.db.setMeta('last_consolidate', new Date().toISOString());
      if (merged > 0) console.log(`[Consolidate] 睡眠巩固：合并 ${merged} 条重复`);
    } catch (e) {
      console.warn('[Consolidate] 跳过:', e);
    }
  }

  /**
   * 主动层 — 让大脑"会提醒你"，而不只是被动等问：
   * ① 挂太久的未决问题(question)；② 最近和过去的你冲突的记忆。生成通知，进 insights 收件箱。
   */
  private async _proactive(): Promise<void> {
    try {
      // ① 未决问题：>14 天未碰、未提醒过
      const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const stale = await this.db.all<{ id: string; name: string; created_at: string }>(
        `SELECT id, name, created_at FROM entities
         WHERE type = 'question' AND last_accessed < ?
           AND json_extract(metadata, '$.proactive_notified') IS NULL
           AND json_extract(metadata, '$.merged_into') IS NULL
         ORDER BY created_at ASC LIMIT 3`,
        [cutoff],
      );
      for (const q of stale) {
        const days = Math.max(1, Math.floor((Date.now() - new Date(q.created_at).getTime()) / 864e5));
        try {
          await this.db.addNotification({ title: '💡 一个挂着的问题', content: `「${q.name}」你琢磨了 ${days} 天还没结论，要不要现在想想？`, type: 'proactive', related_entities: [q.id] } as any);
          await this.db.run(`UPDATE entities SET metadata = json_set(COALESCE(metadata,'{}'), '$.proactive_notified', ?) WHERE id = ?`, [new Date().toISOString(), q.id]);
        } catch { /* */ }
      }

      // ② 新出现的冲突（近 26h，每日触发≈各通知一次）——"和过去的你吵架"
      const since = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
      const conflicts = await this.db.all<{ source_id: string; target_id: string }>(
        `SELECT source_id, target_id FROM relationships
         WHERE type = 'conflicts_with' AND created_at > ? ORDER BY created_at DESC LIMIT 2`,
        [since],
      );
      for (const c of conflicts) {
        const a = await this.db.getEntity(c.source_id);
        const b = await this.db.getEntity(c.target_id);
        if (a && b) {
          try {
            await this.db.addNotification({ title: '⚔️ 和过去的你冲突了', content: `「${a.name}」和「${b.name}」存在冲突——你的想法可能变了，要不要确认一下？`, type: 'proactive', related_entities: [c.source_id, c.target_id] } as any);
          } catch { /* */ }
        }
      }
    } catch (e) {
      console.warn('[Proactive] 跳过:', e);
    }
  }

  private _emptyReport(): DecayReport {
    return {
      relationshipsProcessed: 0,
      relationshipsDecayed: 0,
      relationshipsDormant: 0,
      entitiesStale: 0,
      durationMs: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
