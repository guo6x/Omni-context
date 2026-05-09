import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { cosineSimilarity, encodeEmbedding, decodeEmbedding } from '../utils/math.js';
import * as sqliteVec from 'sqlite-vec';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
sqlite3.verbose();
const MIGRATIONS = [
    {
        version: 1,
        name: 'unified_graph_schema_v2',
        up: `
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        source_file TEXT,
        tags TEXT,
        embedding BLOB,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
        access_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS relationships (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        weight REAL NOT NULL DEFAULT 1.0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_activated TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (source_id) REFERENCES entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES entities(id) ON DELETE CASCADE,
        UNIQUE(source_id, target_id, type)
      );

      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
    },
    {
        version: 2,
        name: 'add_performance_indexes_v2',
        up: `
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_entities_created ON entities(created_at);
      CREATE INDEX IF NOT EXISTS idx_entities_updated ON entities(updated_at);
      CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(type);
      CREATE INDEX IF NOT EXISTS idx_relationships_weight ON relationships(weight);
    `,
    },
    {
        version: 3,
        name: 'add_memory_tables',
        up: `
      -- CoreMemory 表：Letta 范式的核心内存（热记忆）
      CREATE TABLE IF NOT EXISTS core_memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        category TEXT NOT NULL,
        last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
        access_count INTEGER NOT NULL DEFAULT 0
      );

      -- ArchivalMemory 表：Letta 范式的归档内存（长期存储）
      CREATE TABLE IF NOT EXISTS archival_memory (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        summary TEXT,
        tags TEXT,
        embedding BLOB,
        importance REAL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- 核心内存索引
      CREATE INDEX IF NOT EXISTS idx_core_memory_category ON core_memory(category);
      CREATE INDEX IF NOT EXISTS idx_core_memory_access ON core_memory(access_count DESC);

      -- 归档内存索引
      CREATE INDEX IF NOT EXISTS idx_archival_memory_tags ON archival_memory(tags);
      CREATE INDEX IF NOT EXISTS idx_archival_memory_importance ON archival_memory(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_archival_memory_archived ON archival_memory(archived_at);

      -- 实体表补充索引：加速 last_accessed 排序（记忆衰减查询用）
      CREATE INDEX IF NOT EXISTS idx_entities_last_accessed ON entities(last_accessed);
      CREATE INDEX IF NOT EXISTS idx_entities_access_count ON entities(access_count DESC);
    `,
    },
    {
        version: 4,
        name: 'add_vec0_virtual_table',
        up: `
      -- sqlite-vec 向量搜索虚拟表
      -- 注意：此表通过 sqlite-vec 扩展创建，需要先加载扩展
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_entities USING vec0(
        entity_id TEXT PRIMARY KEY,
        embedding FLOAT[384]
      );
    `,
    },
    {
        version: 5,
        name: 'add_fts5_fulltext_search',
        up: `
      -- FTS5 全文检索虚拟表
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_entities USING fts5(
        entity_id UNINDEXED,
        name,
        description,
        tags,
        tokenize = 'unicode61'
      );
    `,
    },
    {
        version: 6,
        name: 'add_notifications_table',
        up: `
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        related_entities TEXT,
        read_status BOOLEAN NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_status);
      CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
    `,
    },
    {
        version: 7,
        name: 'add_core_memory_summary',
        up: `
      ALTER TABLE core_memory ADD COLUMN summary TEXT;
    `,
    },
];
export class Database {
    constructor(db, dbPath, vecEnabled = false) {
        this.vecEnabled = false;
        this.db = db;
        this.dbPath = dbPath;
        this.vecEnabled = vecEnabled;
    }
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                if (err)
                    reject(err);
                else
                    resolve(this);
            });
        });
    }
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err)
                    reject(err);
                else
                    resolve(row);
            });
        });
    }
    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err)
                    reject(err);
                else
                    resolve(rows);
            });
        });
    }
    exec(sql) {
        return new Promise((resolve, reject) => {
            this.db.exec(sql, (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    getRaw() {
        return this.db;
    }
    async runMigrations() {
        // 确保 migrations 表存在（v1 migration 会创建它，但首次运行时需要先检查）
        await this.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
        for (const migration of MIGRATIONS) {
            const applied = await this.get('SELECT * FROM migrations WHERE name = ?', [migration.name]);
            if (!applied) {
                try {
                    await this.exec(migration.up);
                    await this.run('INSERT INTO migrations (name) VALUES (?)', [migration.name]);
                    console.log(`Migration applied: ${migration.name}`);
                }
                catch (error) {
                    console.error(`Migration failed: ${migration.name}`, error);
                    throw error;
                }
            }
        }
    }
    async addEntity(entity) {
        const id = entity.id || uuidv4();
        const now = new Date().toISOString();
        const tagsStr = entity.tags ? JSON.stringify(entity.tags) : null;
        const metadataStr = entity.metadata ? JSON.stringify(entity.metadata) : null;
        const embeddingBlob = entity.embedding ? encodeEmbedding(entity.embedding) : null;
        await this.run(`INSERT INTO entities (id, name, type, description, source_file, tags, embedding, metadata, created_at, updated_at, last_accessed, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, entity.name, entity.type, entity.description || null, entity.source_file || null,
            tagsStr, embeddingBlob, metadataStr, now, now, now, entity.access_count || 0]);
        // 同步向量到 sqlite-vec 虚拟表
        if (entity.embedding) {
            await this._syncVecEmbedding(id, entity.embedding);
        }
        // 同步到 FTS5 全文检索
        await this._syncFtsEntity(id, entity.name, entity.description || '', entity.tags);
        return {
            id,
            name: entity.name,
            type: entity.type,
            description: entity.description || '',
            created_at: now,
            updated_at: now,
            source_file: entity.source_file,
            tags: entity.tags,
            embedding: entity.embedding,
            metadata: entity.metadata,
            last_accessed: now,
            access_count: entity.access_count || 0,
        };
    }
    async getEntity(id) {
        const row = await this.get('SELECT * FROM entities WHERE id = ?', [id]);
        if (!row)
            return null;
        // 命中后再 +1 访问计数，未命中不浪费一次写入
        await this._updateEntityAccess(id);
        return this.rowToEntity(row);
    }
    // 用于不需要计入访问统计的内部读取（如图谱上下文聚合、Agent 巡视）
    async peekEntity(id) {
        const row = await this.get('SELECT * FROM entities WHERE id = ?', [id]);
        if (!row)
            return null;
        return this.rowToEntity(row);
    }
    async getEntitiesByType(type) {
        const rows = await this.all('SELECT * FROM entities WHERE type = ? ORDER BY updated_at DESC', [type]);
        return rows.map(row => this.rowToEntity(row));
    }
    async getRecentEntities(limit = 100) {
        const rows = await this.all('SELECT * FROM entities ORDER BY updated_at DESC LIMIT ?', [Math.max(1, Math.min(limit, 500))]);
        return rows.map(row => this.rowToEntity(row));
    }
    async getCorePrinciples() {
        const rows = await this.all(`
      SELECT * FROM entities
      WHERE type = 'principle'
      AND json_extract(metadata, '$.isCore') = 1
      ORDER BY updated_at DESC
    `);
        return rows.map(row => this.rowToEntity(row));
    }
    async searchEntities(query, limit = 10) {
        // 优先使用 FTS5 全文检索
        try {
            const rows = await this.all(`SELECT e.* FROM fts_entities f
         INNER JOIN entities e ON e.id = f.entity_id
         WHERE fts_entities MATCH ?
         ORDER BY rank
         LIMIT ?`, [query, limit]);
            if (rows.length > 0) {
                return rows.map(row => this.rowToEntity(row));
            }
        }
        catch (e) {
            // FTS5 不可用时回退到 LIKE
        }
        // 回退：LIKE 通配符搜索
        const searchTerm = `%${query}%`;
        const rows = await this.all(`SELECT * FROM entities
       WHERE name LIKE ? OR description LIKE ?
       ORDER BY updated_at DESC LIMIT ?`, [searchTerm, searchTerm, limit]);
        return rows.map(row => this.rowToEntity(row));
    }
    async updateEntity(id, updates) {
        const fields = [];
        const values = [];
        if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.description !== undefined) {
            fields.push('description = ?');
            values.push(updates.description);
        }
        if (updates.tags !== undefined) {
            fields.push('tags = ?');
            values.push(JSON.stringify(updates.tags));
        }
        if (updates.embedding !== undefined) {
            fields.push('embedding = ?');
            values.push(encodeEmbedding(updates.embedding));
        }
        if (updates.metadata !== undefined) {
            fields.push('metadata = ?');
            values.push(JSON.stringify(updates.metadata));
        }
        if (updates.source_file !== undefined) {
            fields.push('source_file = ?');
            values.push(updates.source_file);
        }
        if (fields.length === 0)
            return;
        fields.push("updated_at = datetime('now')");
        values.push(id);
        await this.run(`UPDATE entities SET ${fields.join(', ')} WHERE id = ?`, values);
        // 如果更新了 embedding，同步到 vec 表
        if (updates.embedding !== undefined) {
            await this._syncVecEmbedding(id, updates.embedding);
        }
        // 如果更新了文本字段，同步 FTS
        if (updates.name !== undefined || updates.description !== undefined || updates.tags !== undefined) {
            const current = await this.get('SELECT name, description, tags FROM entities WHERE id = ?', [id]);
            if (current) {
                const tags = current.tags ? JSON.parse(current.tags) : undefined;
                await this._syncFtsEntity(id, current.name, current.description || '', tags);
            }
        }
    }
    async deleteEntity(id) {
        // 先删除 vec 索引
        if (this.vecEnabled) {
            try {
                await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [id]);
            }
            catch (e) { /* vec 删除失败不阻塞 */ }
        }
        // 删除 FTS 索引
        try {
            await this.run('DELETE FROM fts_entities WHERE entity_id = ?', [id]);
        }
        catch (e) { /* FTS 删除失败不阻塞 */ }
        // 防御性清理：即便 PRAGMA foreign_keys 未生效，也保证关系不孤儿
        await this.run('DELETE FROM relationships WHERE source_id = ? OR target_id = ?', [id, id]);
        await this.run('DELETE FROM entities WHERE id = ?', [id]);
    }
    async addRelationship(relationship) {
        const id = relationship.id || uuidv4();
        const now = new Date().toISOString();
        await this.run(`INSERT OR REPLACE INTO relationships (id, source_id, target_id, type, description, weight, created_at, last_activated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, relationship.source_id, relationship.target_id, relationship.type,
            relationship.description || null, relationship.weight || 1.0, now, now]);
        return {
            id,
            source_id: relationship.source_id,
            target_id: relationship.target_id,
            type: relationship.type,
            description: relationship.description,
            weight: relationship.weight || 1.0,
            created_at: now,
            last_activated: now,
        };
    }
    async getRelationshipsForEntity(entityId) {
        const rows = await this.all(`SELECT * FROM relationships WHERE source_id = ? OR target_id = ? ORDER BY weight DESC`, [entityId, entityId]);
        return rows.map(row => ({
            id: row.id,
            source_id: row.source_id,
            target_id: row.target_id,
            type: row.type,
            description: row.description,
            weight: row.weight,
            created_at: row.created_at,
            last_activated: row.last_activated,
        }));
    }
    async getRelationships(limit = 200) {
        const rows = await this.all('SELECT * FROM relationships ORDER BY weight DESC, last_activated DESC LIMIT ?', [Math.max(1, Math.min(limit, 1000))]);
        return rows.map(row => ({
            id: row.id,
            source_id: row.source_id,
            target_id: row.target_id,
            type: row.type,
            description: row.description,
            weight: row.weight,
            created_at: row.created_at,
            last_activated: row.last_activated,
        }));
    }
    async getGraphNeighborhood(entityId, depth = 1) {
        depth = Math.min(depth, 3);
        const nodes = new Map();
        const edges = [];
        const visited = new Set([entityId]);
        const queue = [{ id: entityId, d: 0 }];
        const startEntity = await this.peekEntity(entityId);
        if (!startEntity)
            return { nodes: [], edges: [] };
        nodes.set(entityId, startEntity);
        while (queue.length > 0) {
            const { id, d } = queue.shift();
            const rels = await this.getRelationshipsForEntity(id);
            for (const rel of rels) {
                edges.push(rel);
                const neighborId = rel.source_id === id ? rel.target_id : rel.source_id;
                if (!visited.has(neighborId)) {
                    visited.add(neighborId);
                    const neighborEntity = await this.peekEntity(neighborId);
                    if (neighborEntity) {
                        nodes.set(neighborId, neighborEntity);
                        if (d < depth) {
                            queue.push({ id: neighborId, d: d + 1 });
                        }
                    }
                }
            }
        }
        return { nodes: Array.from(nodes.values()), edges };
    }
    async updateRelationshipWeight(relId, weightChange = 0.1) {
        const now = new Date().toISOString();
        await this.run(`UPDATE relationships
       SET weight = weight + ?, last_activated = ?
       WHERE id = ?`, [weightChange, now, relId]);
    }
    async deleteRelationship(id) {
        await this.run('DELETE FROM relationships WHERE id = ?', [id]);
    }
    /**
     * 向量搜索 — 优先使用 sqlite-vec 原生 KNN，回退到 JS 内存计算
     * @param queryEmbedding 搜索向量
     * @param limit 结果限制
     * @returns 搜索结果（带相似度/距离）
     */
    async vectorSearch(queryEmbedding, limit = 10) {
        // 优先使用 sqlite-vec 原生搜索
        if (this.vecEnabled) {
            return this._vectorSearchNative(queryEmbedding, limit);
        }
        // 回退到 JS 内存计算（兼容 sqlite-vec 不可用的环境）
        return this._vectorSearchFallback(queryEmbedding, limit);
    }
    /**
     * [核心壁垒] sqlite-vec 原生 KNN 向量搜索
     * 数据在 SQLite 层完成计算，不加载到 Node.js 内存
     */
    async _vectorSearchNative(queryEmbedding, limit) {
        // sqlite-vec 要求 Float32Array 格式
        const queryBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);
        // sqlite-vec KNN 需要在 vec0 的 WHERE 中显式提供 k 才能下推；
        // 经 JOIN 后跟随的 LIMIT 不会被 vec0 视为 k 约束（会报
        // "A LIMIT or 'k = ?' constraint is required on vec0 knn queries"），
        // 因此这里强制用 `AND k = ?` 取 KNN，再回 JOIN 取实体明细。
        const rows = await this.all(`SELECT
         v.entity_id AS id,
         v.distance,
         e.name,
         e.type,
         e.description
       FROM vec_entities v
       INNER JOIN entities e ON e.id = v.entity_id
       WHERE v.embedding MATCH ? AND k = ?
       ORDER BY v.distance`, [queryBlob, limit]);
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            type: row.type,
            description: row.description,
            // sqlite-vec 返回 L2 距离，转换为相似度 (0~1)
            similarity: 1 / (1 + row.distance),
        }));
    }
    /**
     * 回退：JS 内存余弦相似度（当 sqlite-vec 不可用时）
     */
    async _vectorSearchFallback(queryEmbedding, limit) {
        const rows = await this.all('SELECT id, name, type, description, embedding FROM entities WHERE embedding IS NOT NULL');
        const results = rows
            .map(row => {
            if (!row.embedding)
                return null;
            const storedEmbedding = decodeEmbedding(row.embedding);
            const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);
            return {
                id: row.id,
                name: row.name,
                type: row.type,
                description: row.description,
                similarity,
            };
        })
            .filter((r) => r !== null)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
        return results;
    }
    /**
     * 将实体的 embedding 同步到 vec_entities 虚拟表
     */
    async _syncVecEmbedding(entityId, embedding) {
        if (!this.vecEnabled)
            return;
        try {
            const vecBlob = Buffer.from(new Float32Array(embedding).buffer);
            // 先尝试删除旧记录（vec0 不支持 UPSERT）
            await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [entityId]);
            await this.run('INSERT INTO vec_entities (entity_id, embedding) VALUES (?, ?)', [entityId, vecBlob]);
        }
        catch (e) {
            console.warn(`[sqlite-vec] 向量同步失败 (${entityId}):`, e);
        }
    }
    // ===================== Notifications (Agent Insights) =====================
    async addNotification(notification) {
        const id = notification.id || uuidv4();
        const now = new Date().toISOString();
        const relatedStr = notification.related_entities ? JSON.stringify(notification.related_entities) : null;
        await this.run(`INSERT INTO notifications (id, title, content, type, related_entities, read_status, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`, [id, notification.title, notification.content, notification.type, relatedStr, now]);
        return {
            id,
            title: notification.title,
            content: notification.content,
            type: notification.type,
            related_entities: notification.related_entities,
            read_status: false,
            created_at: now,
        };
    }
    async getUnreadNotifications() {
        const rows = await this.all('SELECT * FROM notifications WHERE read_status = 0 ORDER BY created_at DESC');
        return rows.map(row => ({
            id: row.id,
            title: row.title,
            content: row.content,
            type: row.type,
            related_entities: row.related_entities ? JSON.parse(row.related_entities) : undefined,
            read_status: Boolean(row.read_status),
            created_at: row.created_at,
        }));
    }
    async markNotificationRead(id) {
        await this.run('UPDATE notifications SET read_status = 1 WHERE id = ?', [id]);
    }
    /**
     * 将实体同步到 FTS5 全文检索虚拟表
     */
    async _syncFtsEntity(entityId, name, description, tags) {
        try {
            // FTS5 不支持 UPSERT，先删后插
            await this.run('DELETE FROM fts_entities WHERE entity_id = ?', [entityId]);
            await this.run('INSERT INTO fts_entities (entity_id, name, description, tags) VALUES (?, ?, ?, ?)', [entityId, name, description, tags ? tags.join(' ') : '']);
        }
        catch (e) {
            // FTS5 虚拟表可能不可用（某些 SQLite 编译版本），不阻塞主流程
            console.warn(`[FTS5] 全文索引同步失败 (${entityId}):`, e);
        }
    }
    rowToEntity(row) {
        return {
            id: row.id,
            name: row.name,
            type: row.type,
            description: row.description || '',
            created_at: row.created_at,
            updated_at: row.updated_at,
            source_file: row.source_file,
            tags: row.tags ? JSON.parse(row.tags) : undefined,
            embedding: row.embedding ? decodeEmbedding(row.embedding) : undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            last_accessed: row.last_accessed,
            access_count: row.access_count,
        };
    }
    async _updateEntityAccess(id) {
        const now = new Date().toISOString();
        await this.run(`UPDATE entities
       SET last_accessed = ?, access_count = access_count + 1
       WHERE id = ?`, [now, id]);
    }
    async beginTransaction() {
        await this.run('BEGIN TRANSACTION');
    }
    async commit() {
        await this.run('COMMIT');
    }
    async rollback() {
        await this.run('ROLLBACK');
    }
    async withTransaction(fn) {
        await this.beginTransaction();
        try {
            const result = await fn();
            await this.commit();
            return result;
        }
        catch (error) {
            await this.rollback();
            throw error;
        }
    }
    async getStats() {
        const entities = await this.get('SELECT COUNT(*) as count FROM entities');
        const relationships = await this.get('SELECT COUNT(*) as count FROM relationships');
        const principles = await this.get('SELECT COUNT(*) as count FROM entities WHERE type = ?', ['principle']);
        const corePrinciples = await this.get(`SELECT COUNT(*) as count FROM entities WHERE type = ? AND json_extract(metadata, '$.isCore') = 1`, ['principle']);
        const evidence = await this.get('SELECT COUNT(*) as count FROM entities WHERE type = ?', ['evidence']);
        return {
            entities: entities?.count || 0,
            relationships: relationships?.count || 0,
            principles: principles?.count || 0,
            corePrinciples: corePrinciples?.count || 0,
            evidence: evidence?.count || 0,
        };
    }
}
export function initDatabase(config = './data/omni-context.db') {
    const dbPath = typeof config === 'string' ? config : config.dbPath;
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    const db = new sqlite3.Database(dbPath);
    // 始终开启外键约束 — 关系表的 ON DELETE CASCADE 才会真正生效，
    // 避免删除实体后留下大量孤儿 relationship 行。
    db.run('PRAGMA foreign_keys = ON');
    if (typeof config === 'object') {
        if (config.enableWAL) {
            db.run('PRAGMA journal_mode = WAL');
        }
        if (config.busyTimeout) {
            db.run(`PRAGMA busy_timeout = ${config.busyTimeout}`);
        }
    }
    // [核心壁垒] 加载 sqlite-vec 扩展（原生向量搜索）
    let vecEnabled = false;
    try {
        sqliteVec.load(db);
        vecEnabled = true;
        console.log('[Database] sqlite-vec 扩展加载成功 ✓');
    }
    catch (e) {
        console.warn('[Database] sqlite-vec 扩展加载失败，将回退到 JS 内存向量搜索:', e);
    }
    return new Database(db, dbPath, vecEnabled);
}
export default initDatabase;
