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
const DEFAULT_CONFIG = {
    decayFactor: 0.95,
    minWeight: 0.05,
    staleDays: 90,
    intervalMs: 60 * 60 * 1000, // 1 小时
    autoStart: true,
};
export class MemoryDecayScheduler {
    constructor(db, config = {}) {
        this.timer = null;
        this.warmupTimer = null;
        this.running = false;
        this.lastReport = null;
        this.db = db;
        this.config = { ...DEFAULT_CONFIG, ...config };
        if (this.config.autoStart) {
            this.start();
        }
    }
    /**
     * 启动定时调度
     */
    start() {
        if (this.timer)
            return;
        console.log(`[MemoryDecay] 启动调度器 (间隔: ${this.config.intervalMs / 1000}s)`);
        // 首次延迟 10 秒执行（等待系统初始化）— 句柄保留，stop 时清理
        this.warmupTimer = setTimeout(() => {
            this.warmupTimer = null;
            this.runDecayCycle();
        }, 10000);
        this.timer = setInterval(() => this.runDecayCycle(), this.config.intervalMs);
    }
    /**
     * 停止调度
     */
    stop() {
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
    async runDecayCycle() {
        if (this.running) {
            console.warn('[MemoryDecay] 上一次衰减周期仍在运行，跳过');
            return this.lastReport || this._emptyReport();
        }
        this.running = true;
        const start = Date.now();
        try {
            const report = {
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
                console.log(`[MemoryDecay] 周期完成: 衰减${report.relationshipsDecayed}条关系, ` +
                    `休眠${report.relationshipsDormant}条, 过期实体${report.entitiesStale}个 ` +
                    `(${report.durationMs}ms)`);
            }
            return report;
        }
        finally {
            this.running = false;
        }
    }
    /**
     * 获取最近一次衰减报告
     */
    getLastReport() {
        return this.lastReport;
    }
    /**
     * 衰减关系权重 — 计算阶段先聚合需要更新的行，再用一次事务批量提交，
     * 避免在大型图谱上做 N 次独立 UPDATE 触发的 fsync 风暴。
     */
    async _decayRelationships(report) {
        // 查找所有非 dormant 的关系
        const relationships = await this.db.all(`SELECT id, weight, last_activated FROM relationships WHERE weight > ?`, [
            this.config.minWeight,
        ]);
        report.relationshipsProcessed = relationships.length;
        const now = Date.now();
        const updates = [];
        for (const rel of relationships) {
            const lastActivated = new Date(rel.last_activated).getTime();
            const daysSince = (now - lastActivated) / (1000 * 60 * 60 * 24);
            if (daysSince < 1)
                continue;
            const newWeight = rel.weight * Math.pow(this.config.decayFactor, daysSince);
            if (newWeight <= this.config.minWeight) {
                updates.push({ id: rel.id, weight: this.config.minWeight, dormant: true });
            }
            else if (Math.abs(newWeight - rel.weight) > 0.001) {
                updates.push({ id: rel.id, weight: Math.round(newWeight * 1000) / 1000, dormant: false });
            }
        }
        if (updates.length === 0)
            return;
        await this.db.withTransaction(async () => {
            for (const u of updates) {
                await this.db.run('UPDATE relationships SET weight = ? WHERE id = ?', [u.weight, u.id]);
                if (u.dormant)
                    report.relationshipsDormant++;
                else
                    report.relationshipsDecayed++;
            }
        });
    }
    /**
     * 标记长期未访问的实体
     */
    async _markStaleEntities(report) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.staleDays);
        const cutoffStr = cutoffDate.toISOString();
        // 查找长期未访问且未标记为 stale 的实体
        const staleEntities = await this.db.all(`SELECT id FROM entities
       WHERE last_accessed < ?
       AND (metadata IS NULL OR json_extract(metadata, '$.stale') IS NULL OR json_extract(metadata, '$.stale') = 0)`, [cutoffStr]);
        if (staleEntities.length === 0)
            return;
        const stamp = new Date().toISOString();
        await this.db.withTransaction(async () => {
            for (const entity of staleEntities) {
                try {
                    await this.db.run(`UPDATE entities
             SET metadata = json_set(COALESCE(metadata, '{}'), '$.stale', 1, '$.stale_since', ?)
             WHERE id = ?`, [stamp, entity.id]);
                    report.entitiesStale++;
                }
                catch {
                    // 单个实体标记失败不影响整体
                }
            }
        });
    }
    /**
     * 强化活跃关系 — 赫布学习规则 "neurons that fire together wire together"
     * 最近 24h 内被访问的实体之间的关系获得微量增强
     */
    async _reinforceActiveRelationships() {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const cutoff = yesterday.toISOString();
        await this.db.run(`UPDATE relationships
       SET weight = MIN(weight * 1.01, 10.0)
       WHERE source_id IN (SELECT id FROM entities WHERE last_accessed > ?)
       AND target_id IN (SELECT id FROM entities WHERE last_accessed > ?)
       AND last_activated > ?`, [cutoff, cutoff, cutoff]);
    }
    _emptyReport() {
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
