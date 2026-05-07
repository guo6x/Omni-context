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

    // 首次延迟 10 秒执行（等待系统初始化）
    setTimeout(() => this.runDecayCycle(), 10_000);
    this.timer = setInterval(() => this.runDecayCycle(), this.config.intervalMs);
  }

  /**
   * 停止调度
   */
  stop(): void {
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
   * 衰减关系权重
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

    for (const rel of relationships) {
      const lastActivated = new Date(rel.last_activated).getTime();
      const daysSince = (now - lastActivated) / (1000 * 60 * 60 * 24);

      if (daysSince < 1) continue; // 一天内的不衰减

      // 艾宾浩斯衰减
      const newWeight = rel.weight * Math.pow(this.config.decayFactor, daysSince);

      if (newWeight <= this.config.minWeight) {
        // 低于阈值，标记为 dormant
        await this.db.run(
          `UPDATE relationships SET weight = ? WHERE id = ?`,
          [this.config.minWeight, rel.id]
        );
        report.relationshipsDormant++;
      } else if (Math.abs(newWeight - rel.weight) > 0.001) {
        // 有实质性衰减
        await this.db.run(
          `UPDATE relationships SET weight = ? WHERE id = ?`,
          [Math.round(newWeight * 1000) / 1000, rel.id]
        );
        report.relationshipsDecayed++;
      }
    }
  }

  /**
   * 标记长期未访问的实体
   */
  private async _markStaleEntities(report: DecayReport): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.staleDays);
    const cutoffStr = cutoffDate.toISOString();

    // 查找长期未访问且未标记为 stale 的实体
    const staleEntities = await this.db.all<{ id: string }>(
      `SELECT id FROM entities
       WHERE last_accessed < ?
       AND (metadata IS NULL OR json_extract(metadata, '$.stale') IS NULL OR json_extract(metadata, '$.stale') = 0)`,
      [cutoffStr]
    );

    for (const entity of staleEntities) {
      try {
        // 通过 metadata 标记 stale，而不是删除
        await this.db.run(
          `UPDATE entities
           SET metadata = json_set(COALESCE(metadata, '{}'), '$.stale', 1, '$.stale_since', ?)
           WHERE id = ?`,
          [new Date().toISOString(), entity.id]
        );
        report.entitiesStale++;
      } catch (e) {
        // 单个实体标记失败不影响整体
      }
    }
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
