import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { Entity, Relationship, SINGLE_VALUED_REL_TYPES } from '../shared-types.js';
import { cosineSimilarity, encodeEmbedding, decodeEmbedding } from '../utils/math.js';
import * as sqliteVec from 'sqlite-vec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

sqlite3.verbose();

export interface DatabaseConfig {
  dbPath: string;
  enableWAL?: boolean;
  busyTimeout?: number;
}

export interface VectorSearchResult {
  id: string;
  name: string;
  type: string;
  description: string;
  similarity: number;
}

export interface GraphNeighborhood {
  nodes: Entity[];
  edges: Relationship[];
}

export interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
}

const MIGRATIONS: Migration[] = [
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
    requiresVec: true,
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
  {
    version: 8,
    name: 'add_temporal_graph_fields',
    up: `
      ALTER TABLE relationships ADD COLUMN valid_from TEXT;
      ALTER TABLE relationships ADD COLUMN valid_until TEXT;
      ALTER TABLE relationships ADD COLUMN invalidated_at TEXT;
      UPDATE relationships SET valid_from = created_at WHERE valid_from IS NULL;
      CREATE INDEX IF NOT EXISTS idx_relationships_valid_until ON relationships(valid_until);
    `,
  },
  {
    version: 9,
    name: 'add_invalidation_reason_to_relationships',
    up: `
      ALTER TABLE relationships ADD COLUMN invalidation_reason TEXT;
    `,
  },
  {
    version: 10,
    name: 'add_app_meta',
    up: `
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `,
  },
  {
    version: 11,
    name: 'add_discussions_table',
    up: `
      CREATE TABLE IF NOT EXISTS discussions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        turns TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_discussions_updated ON discussions(updated_at DESC);
    `,
  },
  {
    version: 12,
    name: 'add_mcp_usage_log',
    up: `
      CREATE TABLE IF NOT EXISTS mcp_usage_log (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        client TEXT,
        query TEXT,
        matched_entities TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_usage_created ON mcp_usage_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mcp_usage_tool ON mcp_usage_log(tool_name);
    `,
  },
  {
    version: 13,
    name: 'add_scoped_device_tokens',
    up: `
      CREATE TABLE IF NOT EXISTS device_tokens (
        token_hash TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        device_type TEXT NOT NULL,
        scopes TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        last_used_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id);
      CREATE INDEX IF NOT EXISTS idx_device_tokens_expires ON device_tokens(expires_at);
      CREATE INDEX IF NOT EXISTS idx_device_tokens_revoked ON device_tokens(revoked_at);
    `,
  },
];

interface Migration {
  version: number;
  name: string;
  up: string;
  down?: string;
  // 该迁移依赖 sqlite-vec 扩展（vec0 虚拟表）。扩展未加载时跳过，
  // 且不记入 migrations 表，下次扩展可用时会重试。
  requiresVec?: boolean;
}

export class Database {
  private db: sqlite3.Database;
  private dbPath: string;
  private vecEnabled: boolean = false;
  // vec_entities 当前维度。migration v4 建表时为 384，但实际维度可能因
  // embedding 模型不同而变（如 OpenAI 1536、bge 768/1024）。首次同步时
  // 从 sqlite_master 读取真实维度，写入维度不符则按需重建表。
  private vecDimension: number = 384;
  private vecDimensionResolved: boolean = false;

  constructor(db: sqlite3.Database, dbPath: string, vecEnabled: boolean = false) {
    this.db = db;
    this.dbPath = dbPath;
    this.vecEnabled = vecEnabled;
  }

  run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T | undefined);
      });
    });
  }

  all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  getRaw(): sqlite3.Database {
    return this.db;
  }

  isInMemory(): boolean {
    return this.dbPath === ':memory:';
  }

  async runMigrations(): Promise<void> {
    // 确保 migrations 表存在（v1 migration 会创建它，但首次运行时需要先检查）
    await this.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    for (const migration of MIGRATIONS) {
      const applied = await this.get<MigrationRecord>(
        'SELECT * FROM migrations WHERE name = ?',
        [migration.name]
      );

      if (!applied) {
        // 依赖 sqlite-vec 的迁移在扩展缺失时跳过，且不记录——
        // 否则 vec0 建表会抛 "no such module: vec0"，中断后续所有迁移
        // （notifications、temporal 字段等都建不出来）。不记录可在
        // 下次扩展可用时自动重试。
        if (migration.requiresVec && !this.vecEnabled) {
          console.warn(`Migration skipped (sqlite-vec unavailable): ${migration.name}`);
          continue;
        }
        try {
          await this.exec(migration.up);
          await this.run(
            'INSERT INTO migrations (name) VALUES (?)',
            [migration.name]
          );
          console.log(`Migration applied: ${migration.name}`);
        } catch (error) {
          console.error(`Migration failed: ${migration.name}`, error);
          throw error;
        }
      }
    }
  }

  async addEntity(entity: Omit<Entity, 'id' | 'created_at' | 'updated_at' | 'last_accessed' | 'access_count'> & {
    id?: string;
    access_count?: number;
  }): Promise<Entity> {
    const id = entity.id || uuidv4();
    const now = new Date().toISOString();
    const tagsStr = entity.tags ? JSON.stringify(entity.tags) : null;
    const metadataStr = entity.metadata ? JSON.stringify(entity.metadata) : null;
    const embeddingBlob = entity.embedding ? encodeEmbedding(entity.embedding) : null;

    await this.run(
      `INSERT INTO entities (id, name, type, description, source_file, tags, embedding, metadata, created_at, updated_at, last_accessed, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, entity.name, entity.type, entity.description || null, entity.source_file || null,
       tagsStr, embeddingBlob, metadataStr, now, now, now, entity.access_count || 0]
    );

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

  async getEntity(id: string): Promise<Entity | null> {
    let currentId = id;
    const seenIds = new Set<string>();
    let row = await this.get<any>('SELECT * FROM entities WHERE id = ?', [currentId]);
    
    while (row) {
      if (seenIds.has(currentId)) break;
      seenIds.add(currentId);
      
      let meta: any = {};
      if (typeof row.metadata === 'string') {
        try { meta = JSON.parse(row.metadata) || {}; } catch {}
      } else if (row.metadata) {
        meta = row.metadata;
      }
      
      if (meta.merged_into) {
        currentId = meta.merged_into;
        row = await this.get<any>('SELECT * FROM entities WHERE id = ?', [currentId]);
      } else {
        break;
      }
    }
    
    if (!row) return null;
    // 命中后再 +1 访问计数，未命中不浪费一次写入
    await this._updateEntityAccess(row.id);
    return this.rowToEntity(row);
  }

  // 用于不需要计入访问统计 of 内部读取（如图谱上下文聚合、Agent 巡视）
  async peekEntity(id: string): Promise<Entity | null> {
    let currentId = id;
    const seenIds = new Set<string>();
    let row = await this.get<any>('SELECT * FROM entities WHERE id = ?', [currentId]);
    
    while (row) {
      if (seenIds.has(currentId)) break;
      seenIds.add(currentId);
      
      let meta: any = {};
      if (typeof row.metadata === 'string') {
        try { meta = JSON.parse(row.metadata) || {}; } catch {}
      } else if (row.metadata) {
        meta = row.metadata;
      }
      
      if (meta.merged_into) {
        currentId = meta.merged_into;
        row = await this.get<any>('SELECT * FROM entities WHERE id = ?', [currentId]);
      } else {
        break;
      }
    }
    
    if (!row) return null;
    return this.rowToEntity(row);
  }

  async getEntitiesByType(type: string): Promise<Entity[]> {
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE type = ? AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY updated_at DESC`,
      [type]
    );
    return rows.map(row => this.rowToEntity(row));
  }

  async getRecentEntities(limit: number = 100): Promise<Entity[]> {
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY updated_at DESC LIMIT ?`,
      [Math.max(1, Math.min(limit, 20000))]
    );
    return rows.map(row => this.rowToEntity(row));
  }

  async getEntityCount(): Promise<number> {
    const row = await this.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM entities
       WHERE json_extract(metadata, '$.merged_into') IS NULL`
    );
    return row?.count ?? 0;
  }

  async getCorePrinciples(): Promise<Entity[]> {
    const rows = await this.all<any>(`
      SELECT * FROM entities
      WHERE type = 'principle'
      AND json_extract(metadata, '$.isCore') = 1
      AND json_extract(metadata, '$.merged_into') IS NULL
      ORDER BY updated_at DESC
    `);
    return rows.map(row => this.rowToEntity(row));
  }

  async searchEntities(query: string, limit: number = 10, type?: string): Promise<Entity[]> {
    // 优先使用 FTS5 全文检索（用户输入需转义，否则特殊字符会触发语法错或意外布尔逻辑）
    const ftsQuery = this._toFtsQuery(query);
    if (ftsQuery) {
      try {
        const typeClause = type ? ' AND e.type = ?' : '';
        const params: any[] = type ? [ftsQuery, type, limit] : [ftsQuery, limit];
        const rows = await this.all<any>(
          `SELECT e.* FROM fts_entities f
           INNER JOIN entities e ON e.id = f.entity_id
           WHERE fts_entities MATCH ? AND json_extract(e.metadata, '$.merged_into') IS NULL${typeClause}
           ORDER BY rank
           LIMIT ?`,
          params
        );
        if (rows.length > 0) {
          return rows.map(row => this.rowToEntity(row));
        }
      } catch (e) {
        // FTS5 不可用时回退到 LIKE
      }
    }

    // 回退：LIKE 通配符搜索
    const searchTerm = `%${query}%`;
    const typeClause = type ? ' AND type = ?' : '';
    const params: any[] = type
      ? [searchTerm, searchTerm, type, limit]
      : [searchTerm, searchTerm, limit];
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE (name LIKE ? OR description LIKE ?) AND json_extract(metadata, '$.merged_into') IS NULL${typeClause}
       ORDER BY updated_at DESC LIMIT ?`,
      params
    );
    return rows.map(row => this.rowToEntity(row));
  }

  /**
   * 把任意用户输入转成 FTS5 安全查询：按空白拆词，每个词作为带引号的 phrase
   * （内部 " 翻倍转义），词间隐式 AND。这样 - ( ) * 和 AND/OR/NOT 等 FTS5
   * 操作符都被当字面量，不会触发语法错误或意外布尔逻辑。空输入返回空串。
   */
  private _toFtsQuery(query: string): string {
    const tokens = query.split(/\s+/).map(t => t.trim()).filter(Boolean);
    if (tokens.length === 0) return '';
    return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' ');
  }

  async reindexEntities(): Promise<void> {
    try { await this.run('DELETE FROM vec_entities'); } catch { /* 可选 */ }
    try { await this.run('DELETE FROM fts_entities'); } catch { /* 可选 */ }
    const rows = await this.all<any>('SELECT id, name, description, tags, embedding FROM entities');
    for (const row of rows) {
      if (row.embedding) {
        try { await this._syncVecEmbedding(row.id, decodeEmbedding(row.embedding)); } catch { /* 可选 */ }
      }
      try {
        const tags = row.tags ? JSON.parse(row.tags) : undefined;
        await this._syncFtsEntity(row.id, row.name, row.description || '', tags);
      } catch { /* 可选 */ }
    }
  }

  async getMeta(key: string): Promise<string | null> {
    try {
      const rows = await this.all<any>('SELECT value FROM app_meta WHERE key = ?', [key]);
      return rows[0]?.value ?? null;
    } catch { return null; }
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.run(
      'INSERT INTO app_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  // 时间词召回：按 created_at（或 last_accessed）落在 [start, end) 的实体，新到旧。
  async getEntitiesByTimeWindow(
    startIso: string,
    endIso: string,
    limit: number,
    field: 'created_at' | 'last_accessed' = 'created_at',
  ): Promise<any[]> {
    const col = field === 'last_accessed' ? 'last_accessed' : 'created_at';
    const rows = await this.all<any>(
      `SELECT id, name, type, description, tags, created_at, last_accessed, access_count
       FROM entities
       WHERE ${col} >= ? AND ${col} < ? AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY ${col} DESC LIMIT ?`,
      [startIso, endIso, limit],
    );
    return rows.map((r) => ({
      id: r.id, name: r.name, type: r.type, description: r.description,
      tags: r.tags ? JSON.parse(r.tags) : undefined,
      created_at: r.created_at, last_accessed: r.last_accessed, access_count: r.access_count,
    }));
  }

  // 用新模型重算所有实体的向量（换 embedding 模型后必跑：旧向量与新模型不可比）。
  // 重算后回灌 vec / fts。逐条容错，单条失败不影响其余。
  async reembedAllEntities(embed: (text: string) => Promise<number[]>): Promise<number> {
    const rows = await this.all<any>('SELECT id, name, description FROM entities');
    let done = 0;
    for (const row of rows) {
      try {
        const vec = await embed(`${row.name}: ${row.description || ''}`);
        await this.run('UPDATE entities SET embedding = ? WHERE id = ?', [encodeEmbedding(vec), row.id]);
        done++;
      } catch { /* 单条失败跳过 */ }
    }
    try { await this.reindexEntities(); } catch { /* 可选 */ }
    return done;
  }

  // 管理/信任面：带 provenance 的实体列表（list_entities 抹了 metadata，这里专门给"看清谁写的"用）
  async listEntitiesForReview(opts: { limit?: number; offset?: number; source?: string; type?: string; q?: string; coreOnly?: boolean; unlinkedOnly?: boolean } = {}): Promise<{ items: any[]; total: number }> {
    const where: string[] = [`json_extract(metadata, '$.merged_into') IS NULL`];
    const params: any[] = [];
    if (opts.type) { where.push('type = ?'); params.push(opts.type); }
    if (opts.coreOnly) {
      where.push(`type = 'principle' AND json_extract(metadata, '$.isCore') IN (1, true)`);
    }
    if (opts.unlinkedOnly) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM relationships r
        WHERE (r.source_id = entities.id OR r.target_id = entities.id)
          AND (r.valid_until IS NULL OR r.valid_until > datetime('now'))
      )`);
    }
    if (opts.source === '__user__') {
      where.push(`(json_extract(metadata, '$.provenance.source') IS NULL OR json_extract(metadata, '$.provenance.source') = 'user')`);
    } else if (opts.source) {
      where.push(`json_extract(metadata, '$.provenance.source') = ?`); params.push(opts.source);
    }
    if (opts.q) { where.push('(name LIKE ? OR description LIKE ?)'); const like = `%${opts.q}%`; params.push(like, like); }
    const whereSql = where.join(' AND ');
    const totalRow = await this.get<{ c: number }>(`SELECT COUNT(*) as c FROM entities WHERE ${whereSql}`, params);
    const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
    const offset = Math.max(opts.offset || 0, 0);
    const rows = await this.all<any>(
      `SELECT id, name, type, description, tags, metadata, created_at, last_accessed, access_count
       FROM entities WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const items = rows.map((r) => {
      let meta: any = {};
      try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch { /* */ }
      const prov = meta.provenance || null;
      return {
        id: r.id, name: r.name, type: r.type,
        description: (r.description || '').slice(0, 180),
        tags: r.tags ? JSON.parse(r.tags) : [],
        created_at: r.created_at, last_accessed: r.last_accessed, access_count: r.access_count,
        isCore: meta.isCore === true || meta.isCore === 1,
        source: prov?.source || 'user',
        provenance: prov,
      };
    });
    return { items, total: totalRow?.c ?? items.length };
  }

  async getReviewTaskSummary(targetCoreCount = 30): Promise<{
    generatedAt: string;
    corePrinciples: {
      total: number;
      target: number;
      overLimit: number;
      lowSignal: number;
      keepSamples: any[];
      demoteSamples: any[];
    };
    unlinkedByType: Array<{ type: string; total: number; samples: any[] }>;
  }> {
    const target = Math.min(Math.max(Math.floor(Number(targetCoreCount) || 30), 5), 100);
    const coreWhere = `type = 'principle'
      AND json_extract(metadata, '$.isCore') IN (1, true)
      AND json_extract(metadata, '$.merged_into') IS NULL`;
    const coreRow = await this.get<{ c: number }>(`SELECT COUNT(*) as c FROM entities WHERE ${coreWhere}`);
    const lowSignalRow = await this.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM entities
       WHERE ${coreWhere}
         AND (COALESCE(access_count, 0) <= 1 OR last_accessed IS NULL)`,
    );
    const keepSamples = await this.listEntitiesForReview({ type: 'principle', coreOnly: true, limit: 5 });
    const demoteRows = await this.all<any>(
      `SELECT id, name, type, description, tags, metadata, created_at, last_accessed, access_count
       FROM entities
       WHERE ${coreWhere}
       ORDER BY COALESCE(access_count, 0) ASC,
         CASE WHEN last_accessed IS NULL THEN 0 ELSE 1 END ASC,
         COALESCE(last_accessed, created_at) ASC,
         created_at ASC
       LIMIT 5`,
    );
    const demoteSamples = demoteRows.map((r) => {
      let meta: any = {};
      try { meta = r.metadata ? JSON.parse(r.metadata) : {}; } catch { /* */ }
      const prov = meta.provenance || null;
      return {
        id: r.id,
        name: r.name,
        type: r.type,
        description: (r.description || '').slice(0, 180),
        tags: r.tags ? JSON.parse(r.tags) : [],
        created_at: r.created_at,
        last_accessed: r.last_accessed,
        access_count: r.access_count,
        isCore: meta.isCore === true || meta.isCore === 1,
        source: prov?.source || 'user',
        provenance: prov,
      };
    });

    const unlinkedRows = await this.all<{ type: string; c: number }>(
      `SELECT type, COUNT(*) AS c
       FROM entities
       WHERE json_extract(metadata, '$.merged_into') IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM relationships r
           WHERE (r.source_id = entities.id OR r.target_id = entities.id)
             AND (r.valid_until IS NULL OR r.valid_until > datetime('now'))
         )
       GROUP BY type
       HAVING c > 0
       ORDER BY c DESC
       LIMIT 8`,
    );
    const unlinkedByType = [];
    for (const row of unlinkedRows) {
      const samples = await this.listEntitiesForReview({ type: row.type, unlinkedOnly: true, limit: 5 });
      unlinkedByType.push({ type: row.type, total: row.c, samples: samples.items });
    }

    const totalCore = coreRow?.c ?? 0;
    return {
      generatedAt: new Date().toISOString(),
      corePrinciples: {
        total: totalCore,
        target,
        overLimit: Math.max(totalCore - target, 0),
        lowSignal: lowSignalRow?.c ?? 0,
        keepSamples: keepSamples.items,
        demoteSamples,
      },
      unlinkedByType,
    };
  }

  async demoteExcessCorePrinciples(targetCoreCount = 30): Promise<{
    totalBefore: number;
    target: number;
    kept: number;
    demoted: number;
    items: Array<{ id: string; name: string; access_count: number }>;
  }> {
    const target = Math.min(Math.max(Math.floor(Number(targetCoreCount) || 30), 5), 100);
    const rows = await this.all<{ id: string; name: string; access_count: number }>(
      `SELECT id, name, COALESCE(access_count, 0) AS access_count
       FROM entities
       WHERE type = 'principle'
         AND json_extract(metadata, '$.isCore') IN (1, true)
         AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY COALESCE(access_count, 0) DESC,
         CASE WHEN last_accessed IS NULL THEN 0 ELSE 1 END DESC,
         COALESCE(last_accessed, created_at) DESC,
         LENGTH(COALESCE(description, '')) DESC,
         created_at ASC`,
    );
    if (rows.length <= target) {
      return { totalBefore: rows.length, target, kept: rows.length, demoted: 0, items: [] };
    }
    const demoteRows = rows.slice(target);
    await this.withTransaction(async () => {
      const now = new Date().toISOString();
      for (const row of demoteRows) {
        await this.run(
          `UPDATE entities SET metadata = json_set(COALESCE(metadata,'{}'), '$.isCore', 0), updated_at = ? WHERE id = ?`,
          [now, row.id],
        );
      }
    });
    return {
      totalBefore: rows.length,
      target,
      kept: target,
      demoted: demoteRows.length,
      items: demoteRows.slice(0, 20),
    };
  }

  // 按 provenance.source 统计（管理面的过滤角标）
  async countEntitiesBySource(): Promise<Record<string, number>> {
    const rows = await this.all<any>(
      `SELECT COALESCE(json_extract(metadata, '$.provenance.source'), 'user') AS src, COUNT(*) AS c
       FROM entities WHERE json_extract(metadata, '$.merged_into') IS NULL GROUP BY src`,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.src || 'user'] = r.c;
    return out;
  }

  // ── 整理 / curation 原语 ──

  // 设/撤核心原则（json_set 非破坏，只翻 isCore，保留其余 metadata）
  async setCorePrinciple(id: string, isCore: boolean): Promise<void> {
    await this.run(
      `UPDATE entities SET metadata = json_set(COALESCE(metadata,'{}'), '$.isCore', ?), updated_at = ? WHERE id = ?`,
      [isCore ? 1 : 0, new Date().toISOString(), id],
    );
  }

  // 软合并：dropId 的关系指到 keepId，dropId 标记 merged_into=keepId（可逆，不硬删）
  async softMergeEntities(keepId: string, dropId: string): Promise<void> {
    if (!keepId || !dropId || keepId === dropId) return;
    await this.withTransaction(async () => {
      // 转挂关系：OR IGNORE 跳过会撞 UNIQUE(source_id,target_id,type) 的行（keepId 已有等价关系），
      // 否则唯一约束冲突会让整个合并事务 500 回滚、合并失败。
      await this.run('UPDATE OR IGNORE relationships SET source_id = ? WHERE source_id = ?', [keepId, dropId]);
      await this.run('UPDATE OR IGNORE relationships SET target_id = ? WHERE target_id = ?', [keepId, dropId]);
      // 清掉转挂副作用：keepId 自环（dropId 原本就与 keepId 相连）+ 因冲突被 IGNORE 仍残留在 dropId 上的重复关系
      await this.run('DELETE FROM relationships WHERE source_id = ? AND target_id = ?', [keepId, keepId]);
      await this.run('DELETE FROM relationships WHERE source_id = ? OR target_id = ?', [dropId, dropId]);
      await this.run(
        `UPDATE entities SET metadata = json_set(COALESCE(metadata,'{}'), '$.merged_into', ?), updated_at = ? WHERE id = ?`,
        [keepId, new Date().toISOString(), dropId],
      );
    });
    try { await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [dropId]); } catch { /* */ }
    try { await this.run('DELETE FROM fts_entities WHERE entity_id = ?', [dropId]); } catch { /* */ }
    this.bumpAccessCounts([keepId]).catch(() => {});
  }

  // 硬删除（含关系/索引清理）。仅供用户主动调用；睡眠巩固不用它。
  async hardDeleteEntity(id: string): Promise<void> {
    await this.withTransaction(async () => {
      await this.run('DELETE FROM relationships WHERE source_id = ? OR target_id = ?', [id, id]);
      await this.run('DELETE FROM entities WHERE id = ?', [id]);
    });
    try { await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [id]); } catch { /* */ }
    try { await this.run('DELETE FROM fts_entities WHERE entity_id = ?', [id]); } catch { /* */ }
  }

  // 找完全同名同类型的重复组（未合并的）。每组按 keeper 优先排序（热度/描述长/最早）。
  async findExactDuplicateGroups(): Promise<Array<{ ids: string[]; name: string; type: string }>> {
    const rows = await this.all<any>(
      `SELECT id, name, type
       FROM entities
       WHERE json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY type, LOWER(TRIM(name)), access_count DESC, LENGTH(COALESCE(description,'')) DESC, created_at ASC`,
    );
    const groups = new Map<string, any[]>();
    for (const r of rows) {
      const key = (r.type || '') + '|' + (r.name || '').trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    const dup: Array<{ ids: string[]; name: string; type: string }> = [];
    for (const arr of groups.values()) {
      if (arr.length > 1) dup.push({ ids: arr.map((x) => x.id), name: arr[0].name, type: arr[0].type });
    }
    return dup;
  }

  async updateEntity(id: string, updates: Partial<Omit<Entity, 'id' | 'updated_at' | 'last_accessed'>>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.type !== undefined) {
      fields.push('type = ?');
      values.push(updates.type);
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
    if (updates.created_at !== undefined) {
      fields.push('created_at = ?');
      values.push(updates.created_at);
    }
    if (updates.access_count !== undefined) {
      fields.push('access_count = ?');
      values.push(updates.access_count);
    }

    if (fields.length === 0) return;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    await this.run(
      `UPDATE entities SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    // 如果更新了 embedding，同步到 vec 表
    if (updates.embedding !== undefined) {
      await this._syncVecEmbedding(id, updates.embedding);
    }

    // 如果更新了文本字段，同步 FTS
    if (updates.name !== undefined || updates.description !== undefined || updates.tags !== undefined) {
      const current = await this.get<any>('SELECT name, description, tags FROM entities WHERE id = ?', [id]);
      if (current) {
        const tags = current.tags ? JSON.parse(current.tags) : undefined;
        await this._syncFtsEntity(id, current.name, current.description || '', tags);
      }
    }
  }

  async deleteEntity(id: string): Promise<void> {
    // 先删除 vec 索引
    if (this.vecEnabled) {
      try {
        await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [id]);
      } catch (e) { /* vec 删除失败不阻塞 */ }
    }
    // 删除 FTS 索引
    try {
      await this.run('DELETE FROM fts_entities WHERE entity_id = ?', [id]);
    } catch (e) { /* FTS 删除失败不阻塞 */ }
    // 防御性清理：即便 PRAGMA foreign_keys 未生效，也保证关系不孤儿
    await this.run('DELETE FROM relationships WHERE source_id = ? OR target_id = ?', [id, id]);
    await this.run('DELETE FROM entities WHERE id = ?', [id]);
  }

  /**
   * 合并 sourceId 到 targetId：把 source 的所有关系迁移到 target，
   * 合并 tags（去重），追加 description（如果不同），然后删除 source。
   * 自环（source 与 target 之间的关系）会被丢弃，避免合并后产生自指。
   */
  async mergeEntities(sourceId: string, targetId: string): Promise<{ moved: number; dropped: number }> {
    if (sourceId === targetId) throw new Error('Cannot merge entity into itself');
    const source = await this.get<any>('SELECT * FROM entities WHERE id = ?', [sourceId]);
    const target = await this.get<any>('SELECT * FROM entities WHERE id = ?', [targetId]);
    if (!source || !target) throw new Error('Source or target entity not found');

    // 合并 tags（去重）
    const sourceTags: string[] = source.tags ? JSON.parse(source.tags) : [];
    const targetTags: string[] = target.tags ? JSON.parse(target.tags) : [];
    const mergedTags = Array.from(new Set([...targetTags, ...sourceTags]));

    // 合并 description（target 已有则追加 source，没有则用 source）
    let mergedDesc = target.description || '';
    if (source.description && source.description !== target.description) {
      mergedDesc = mergedDesc
        ? `${mergedDesc}\n\n—— 合并自 ${source.name}：\n${source.description}`
        : source.description;
    }

    await this.updateEntity(targetId, {
      tags: mergedTags,
      description: mergedDesc,
    });

    // 迁移关系：source → X 改为 target → X，X → source 改为 X → target
    // 同时丢弃自环
    const outgoing = await this.all<any>(
      'SELECT id, target_id FROM relationships WHERE source_id = ?',
      [sourceId]
    );
    const incoming = await this.all<any>(
      'SELECT id, source_id FROM relationships WHERE target_id = ?',
      [sourceId]
    );

    let moved = 0;
    let dropped = 0;
    for (const r of outgoing) {
      if (r.target_id === targetId) {
        await this.run('DELETE FROM relationships WHERE id = ?', [r.id]);
        dropped++;
      } else {
        await this.run('UPDATE relationships SET source_id = ? WHERE id = ?', [targetId, r.id]);
        moved++;
      }
    }
    for (const r of incoming) {
      if (r.source_id === targetId) {
        await this.run('DELETE FROM relationships WHERE id = ?', [r.id]);
        dropped++;
      } else {
        await this.run('UPDATE relationships SET target_id = ? WHERE id = ?', [targetId, r.id]);
        moved++;
      }
    }

    // 最后删除 source（这会顺带清掉 vec/fts/关系防御清理）
    await this.deleteEntity(sourceId);
    return { moved, dropped };
  }

  async addRelationship(relationship: Omit<Relationship, 'id' | 'created_at' | 'last_activated' | 'valid_from'> & {
    id?: string;
    valid_from?: string;
    invalidation_reason?: string;
  }): Promise<Relationship> {
    const id = relationship.id || uuidv4();
    const now = new Date().toISOString();
    const validFrom = relationship.valid_from || now;
    const validUntil = relationship.valid_until || null;
    const invalidatedAt = relationship.invalidated_at || null;
    const invalidationReason = relationship.invalidation_reason || null;

    // 自动冲突检测：如果是单值关系，且是新增的有效关系
    if (SINGLE_VALUED_REL_TYPES.includes(relationship.type) && !validUntil && !invalidatedAt) {
      // 找出该 source 下同 type 但不同 target 的当前有效的旧关系
      const existing = await this.all<Relationship>(
        `SELECT * FROM relationships 
         WHERE source_id = ? AND type = ? AND target_id != ?
           AND (valid_until IS NULL OR valid_until > ?)`,
        [relationship.source_id, relationship.type, relationship.target_id, now]
      );
      for (const rel of existing) {
        await this.invalidateRelationship(rel.id, `superseded by extraction at ${validFrom}`);
      }
    }

    await this.run(
      `INSERT OR REPLACE INTO relationships (id, source_id, target_id, type, description, weight, created_at, last_activated, valid_from, valid_until, invalidated_at, invalidation_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, relationship.source_id, relationship.target_id, relationship.type,
       relationship.description || null, relationship.weight || 1.0, now, now, validFrom, validUntil, invalidatedAt, invalidationReason]
    );

    return {
      id,
      source_id: relationship.source_id,
      target_id: relationship.target_id,
      type: relationship.type,
      description: relationship.description,
      weight: relationship.weight || 1.0,
      created_at: now,
      last_activated: now,
      valid_from: validFrom,
      valid_until: validUntil || undefined,
      invalidated_at: invalidatedAt || undefined,
      invalidation_reason: invalidationReason || undefined,
    };
  }

  async invalidateRelationship(id: string, reason?: string, validUntil?: string): Promise<void> {
    const now = new Date().toISOString();
    const until = validUntil || now;
    await this.run(
      `UPDATE relationships
       SET valid_until = ?, invalidated_at = ?, invalidation_reason = ?
       WHERE id = ?`,
      [until, now, reason || null, id]
    );
  }

  async getRelationshipsForEntity(entityId: string, includeHistorical: boolean = false): Promise<Relationship[]> {
    const now = new Date().toISOString();
    let query = `SELECT * FROM relationships WHERE (source_id = ? OR target_id = ?)`;
    const params = [entityId, entityId];

    if (!includeHistorical) {
      query += ` AND (valid_until IS NULL OR valid_until > ?)`;
      params.push(now);
    }

    query += ` ORDER BY weight DESC`;

    const rows = await this.all<any>(query, params);
    return rows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      target_id: row.target_id,
      type: row.type,
      description: row.description || undefined,
      weight: row.weight,
      created_at: row.created_at,
      last_activated: row.last_activated,
      valid_from: row.valid_from,
      valid_until: row.valid_until || undefined,
      invalidated_at: row.invalidated_at || undefined,
      invalidation_reason: row.invalidation_reason || undefined,
    }));
  }

  async getRelationships(limit: number = 200, includeHistorical: boolean = false): Promise<Relationship[]> {
    const now = new Date().toISOString();
    let query = 'SELECT * FROM relationships';
    const params: any[] = [];

    if (!includeHistorical) {
      query += ' WHERE (valid_until IS NULL OR valid_until > ?)';
      params.push(now);
    }

    query += ' ORDER BY weight DESC, last_activated DESC LIMIT ?';
    params.push(Math.max(1, Math.min(limit, 60000)));

    const rows = await this.all<any>(query, params);
    return rows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      target_id: row.target_id,
      type: row.type,
      description: row.description || undefined,
      weight: row.weight,
      created_at: row.created_at,
      last_activated: row.last_activated,
      valid_from: row.valid_from,
      valid_until: row.valid_until || undefined,
      invalidated_at: row.invalidated_at || undefined,
      invalidation_reason: row.invalidation_reason || undefined,
    }));
  }

  async getRelationshipsForEntities(entityIds: string[], includeHistorical: boolean = false): Promise<Relationship[]> {
    if (entityIds.length === 0) return [];
    const now = new Date().toISOString();
    const placeholders = entityIds.map(() => '?').join(',');
    let query = `SELECT * FROM relationships WHERE (source_id IN (${placeholders}) OR target_id IN (${placeholders}))`;
    const params = [...entityIds, ...entityIds];

    if (!includeHistorical) {
      query += ` AND (valid_until IS NULL OR valid_until > ?)`;
      params.push(now);
    }

    query += ` ORDER BY weight DESC`;

    const rows = await this.all<any>(query, params);
    return rows.map(row => ({
      id: row.id,
      source_id: row.source_id,
      target_id: row.target_id,
      type: row.type,
      description: row.description || undefined,
      weight: row.weight,
      created_at: row.created_at,
      last_activated: row.last_activated,
      valid_from: row.valid_from,
      valid_until: row.valid_until || undefined,
      invalidated_at: row.invalidated_at || undefined,
      invalidation_reason: row.invalidation_reason || undefined,
    }));
  }

  async peekEntities(ids: string[]): Promise<Entity[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = await this.all<any>(`SELECT * FROM entities WHERE id IN (${placeholders})`, ids);
    
    const entities: Entity[] = [];
    for (const row of rows) {
      let meta: any = {};
      if (typeof row.metadata === 'string') {
        try { meta = JSON.parse(row.metadata) || {}; } catch {}
      } else if (row.metadata) {
        meta = row.metadata;
      }
      
      if (meta.merged_into) {
        // 如果存在 merged_into，单独走 peekEntity 兜底
        const resolved = await this.peekEntity(row.id);
        if (resolved) {
          entities.push(resolved);
        }
      } else {
        entities.push(this.rowToEntity(row));
      }
    }
    return entities;
  }

  async getGraphNeighborhood(entityId: string, depth: number = 1, includeHistorical: boolean = false): Promise<GraphNeighborhood> {
    depth = Math.min(depth, 3);
    const nodes = new Map<string, Entity>();
    const edgesMap = new Map<string, Relationship>();
    const visited = new Set<string>([entityId]);

    const startEntity = await this.peekEntity(entityId);
    if (!startEntity) return { nodes: [], edges: [] };
    nodes.set(entityId, startEntity);

    let frontier = [entityId];

    for (let d = 0; d < depth; d++) {
      if (frontier.length === 0) break;

      const rels = await this.getRelationshipsForEntities(frontier, includeHistorical);
      const nextFrontierCandidates = new Set<string>();

      for (const rel of rels) {
        if (!edgesMap.has(rel.id)) {
          edgesMap.set(rel.id, rel);
        }

        const sourceInFrontier = frontier.includes(rel.source_id);
        const targetInFrontier = frontier.includes(rel.target_id);

        if (sourceInFrontier) {
          const neighborId = rel.target_id;
          if (!visited.has(neighborId)) {
            nextFrontierCandidates.add(neighborId);
          }
        }
        if (targetInFrontier) {
          const neighborId = rel.source_id;
          if (!visited.has(neighborId)) {
            nextFrontierCandidates.add(neighborId);
          }
        }
      }

      if (nextFrontierCandidates.size === 0) {
        break;
      }

      const newNeighborsList = Array.from(nextFrontierCandidates);
      const newEntities = await this.peekEntities(newNeighborsList);

      const nextFrontier: string[] = [];
      for (const entity of newEntities) {
        if (!nodes.has(entity.id)) {
          nodes.set(entity.id, entity);
          visited.add(entity.id);
          nextFrontier.push(entity.id);
        }
      }
      frontier = nextFrontier;
    }

    return {
      nodes: Array.from(nodes.values()),
      edges: Array.from(edgesMap.values())
    };
  }

  async updateRelationshipWeight(relId: string, weightChange: number = 0.1): Promise<void> {
    const now = new Date().toISOString();
    await this.run(
      `UPDATE relationships
       SET weight = weight + ?, last_activated = ?
       WHERE id = ?`,
      [weightChange, now, relId]
    );
  }

  async deleteRelationship(id: string): Promise<void> {
    await this.run('DELETE FROM relationships WHERE id = ?', [id]);
  }

  /**
   * 向量搜索 — 优先使用 sqlite-vec 原生 KNN，回退到 JS 内存计算
   * @param queryEmbedding 搜索向量
   * @param limit 结果限制
   * @returns 搜索结果（带相似度/距离）
   */
  async vectorSearch(queryEmbedding: number[], limit: number = 10): Promise<VectorSearchResult[]> {
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
  private async _vectorSearchNative(queryEmbedding: number[], limit: number): Promise<VectorSearchResult[]> {
    // sqlite-vec 要求 Float32Array 格式
    const queryBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);

    // sqlite-vec KNN 需要在 vec0 的 WHERE 中显式提供 k 才能下推；
    // 经 JOIN 后跟随的 LIMIT 不会被 vec0 视为 k 约束（会报
    // "A LIMIT or 'k = ?' constraint is required on vec0 knn queries"），
    // 因此这里强制用 `AND k = ?` 取 KNN，再回 JOIN 取实体明细。
    const rows = await this.all<any>(
      `SELECT
         v.entity_id AS id,
         v.distance,
         e.name,
         e.type,
         e.description
       FROM vec_entities v
       INNER JOIN entities e ON e.id = v.entity_id
       WHERE v.embedding MATCH ? AND k = ? AND json_extract(e.metadata, '$.merged_into') IS NULL
       ORDER BY v.distance`,
      [queryBlob, limit]
    );

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
  private async _vectorSearchFallback(queryEmbedding: number[], limit: number): Promise<VectorSearchResult[]> {
    // 仅在 sqlite-vec 不可用时走这里。一次性把所有带向量的实体读进内存做余弦相似度，
    // 实体过万时内存可达数百 MB，故按热度（access_count / last_accessed）取前 N 作候选，
    // 用召回率换取内存安全。
    const CANDIDATE_CAP = 5000;
    const rows = await this.all<any>(
      `SELECT id, name, type, description, embedding FROM entities
       WHERE embedding IS NOT NULL AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY access_count DESC, last_accessed DESC
       LIMIT ?`,
      [CANDIDATE_CAP]
    );

    const results: VectorSearchResult[] = rows
      .map(row => {
        if (!row.embedding) return null;
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
      .filter((r): r is VectorSearchResult => r !== null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  /**
   * 将实体的 embedding 同步到 vec_entities 虚拟表
   */
  private async _syncVecEmbedding(entityId: string, embedding: number[]): Promise<void> {
    if (!this.vecEnabled) return;
    try {
      await this._resolveVecDimension();
      // embedding 维度与 vec 表声明维度不符（用户切换了模型）：按实际维度重建，
      // 否则 vec0 会拒绝写入，导致整列向量静默丢失、KNN 失效。
      if (embedding.length !== this.vecDimension) {
        await this._recreateVecTable(embedding.length);
      }
      const vecBlob = Buffer.from(new Float32Array(embedding).buffer);
      // 先尝试删除旧记录（vec0 不支持 UPSERT）
      await this.run('DELETE FROM vec_entities WHERE entity_id = ?', [entityId]);
      await this.run(
        'INSERT INTO vec_entities (entity_id, embedding) VALUES (?, ?)',
        [entityId, vecBlob]
      );
    } catch (e) {
      console.warn(`[sqlite-vec] 向量同步失败 (${entityId}):`, e);
    }
  }

  /** 从 sqlite_master 读取 vec_entities 的真实声明维度（只做一次） */
  private async _resolveVecDimension(): Promise<void> {
    if (this.vecDimensionResolved) return;
    this.vecDimensionResolved = true;
    try {
      const row = await this.get<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'vec_entities'"
      );
      const m = row?.sql?.match(/\[\s*(\d+)\s*\]/);
      if (m) this.vecDimension = parseInt(m[1], 10);
    } catch {
      /* 读不到则保留默认 384 */
    }
  }

  /**
   * 按指定维度重建 vec_entities。切换 embedding 模型会改变向量空间，
   * 旧向量与新向量本就不可比较，因此重建为空表是可接受的（实体表里的
   * 旧 embedding BLOB 仍在，如需可调用 reindexEntities 重灌当前维度的向量）。
   */
  private async _recreateVecTable(dim: number): Promise<void> {
    await this.run('DROP TABLE IF EXISTS vec_entities');
    await this.run(
      `CREATE VIRTUAL TABLE vec_entities USING vec0(entity_id TEXT PRIMARY KEY, embedding FLOAT[${dim}])`
    );
    this.vecDimension = dim;
    console.warn(`[sqlite-vec] vec_entities 维度已调整为 ${dim}（embedding 模型变更），向量索引已重建`);
  }

  // ===================== Notifications (Agent Insights) =====================

  async addNotification(notification: Omit<import('../shared-types.js').Notification, 'id' | 'created_at' | 'read_status'> & { id?: string }): Promise<import('../shared-types.js').Notification> {
    const id = notification.id || uuidv4();
    const now = new Date().toISOString();
    const relatedStr = notification.related_entities ? JSON.stringify(notification.related_entities) : null;

    await this.run(
      `INSERT INTO notifications (id, title, content, type, related_entities, read_status, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [id, notification.title, notification.content, notification.type, relatedStr, now]
    );

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

  async hasRecentNotification(titlePrefix: string, days: number, contentIncludes?: string): Promise<boolean> {
    const safeDays = Math.max(1, Math.min(Math.floor(days), 365));
    const contentClause = contentIncludes ? ' AND content LIKE ?' : '';
    const params: Array<string | number> = [`${titlePrefix}%`, safeDays];
    if (contentIncludes) params.push(`%${contentIncludes}%`);
    const row = await this.get<{ c: number }>(
      `SELECT COUNT(*) AS c FROM notifications
       WHERE title LIKE ?
         AND created_at > datetime('now', '-' || ? || ' days')
         ${contentClause}`,
      params,
    );
    return (row?.c ?? 0) > 0;
  }

  async getUnreadNotifications(): Promise<import('../shared-types.js').Notification[]> {
    const rows = await this.all<any>(
      'SELECT * FROM notifications WHERE read_status = 0 ORDER BY created_at DESC'
    );
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

  async markNotificationRead(id: string): Promise<void> {
    await this.run('UPDATE notifications SET read_status = 1 WHERE id = ?', [id]);
  }

  async getNotification(id: string): Promise<import('../shared-types.js').Notification | null> {
    const rows = await this.all<any>('SELECT * FROM notifications WHERE id = ?', [id]);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      type: row.type,
      related_entities: row.related_entities ? JSON.parse(row.related_entities) : undefined,
      read_status: Boolean(row.read_status),
      created_at: row.created_at,
    };
  }

  async promoteInsightToGraph(notificationId: string): Promise<{ entity: Entity; linked: number } | null> {
    const n = await this.getNotification(notificationId);
    if (!n || n.type !== 'insight' || n.read_status === true) {
      return null;
    }

    const entityName = n.title.slice(0, 120);
    const entityDescription = n.content;
    const insightEntity = await this.addEntity({
      name: entityName,
      type: 'concept',
      description: entityDescription,
      tags: ['insight', 'agent-loop'],
      metadata: {
        provenance: {
          source: 'agent-loop',
          generated_at: n.created_at
        },
        insight: true
      }
    });

    let linkedCount = 0;
    const relatedEntities = n.related_entities || [];
    for (const targetId of relatedEntities) {
      const targetEntity = await this.peekEntity(targetId);
      if (targetEntity) {
        await this.addRelationship({
          source_id: insightEntity.id,
          target_id: targetId,
          type: 'derived_from',
          description: '由 Agent 洞见关联',
          weight: 0.6
        });
        linkedCount++;
      }
    }

    await this.markNotificationRead(notificationId);

    return {
      entity: insightEntity,
      linked: linkedCount
    };
  }

  async getEntitiesForConsolidation(limit = 5): Promise<Entity[]> {
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE json_extract(metadata, '$.merged_into') IS NULL
         AND ( json_extract(metadata, '$.consolidated_at') IS NULL
               OR datetime(json_extract(metadata, '$.consolidated_at')) < datetime(updated_at) )
       ORDER BY COALESCE(cast(json_extract(metadata, '$.importance') as real), 0.5) DESC, updated_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(row => this.rowToEntity(row));
  }

  async markEntitiesConsolidated(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const placeholders = ids.map(() => '?').join(',');
    await this.run(
      `UPDATE entities
       SET metadata = json_set(COALESCE(metadata, '{}'), '$.consolidated_at', ?)
       WHERE id IN (${placeholders})`,
      [now, ...ids]
    );
  }

  // ── 问大脑会话（可续聊的思考记录，独立于记忆，不进召回）──
  async listDiscussions(limit = 50): Promise<Array<{ id: string; title: string; updated_at: string; turns: number }>> {
    const rows = await this.all<any>(
      'SELECT id, title, turns, updated_at FROM discussions ORDER BY updated_at DESC LIMIT ?',
      [limit]
    );
    return rows.map((r) => {
      let n = 0;
      try { const a = JSON.parse(r.turns); n = Array.isArray(a) ? a.length : 0; } catch { /* */ }
      return { id: r.id, title: r.title, updated_at: r.updated_at, turns: n };
    });
  }

  async getDiscussion(id: string): Promise<{ id: string; title: string; turns: any[]; created_at: string; updated_at: string } | null> {
    const rows = await this.all<any>('SELECT * FROM discussions WHERE id = ?', [id]);
    const row = rows[0];
    if (!row) return null;
    let turns: any[] = [];
    try { const a = JSON.parse(row.turns); if (Array.isArray(a)) turns = a; } catch { /* */ }
    return { id: row.id, title: row.title, turns, created_at: row.created_at, updated_at: row.updated_at };
  }

  async upsertDiscussion(input: { id?: string | null; title: string; turns: any[] }): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const turnsStr = JSON.stringify(input.turns || []);
    if (input.id) {
      const rows = await this.all<any>('SELECT id FROM discussions WHERE id = ?', [input.id]);
      if (rows[0]) {
        await this.run('UPDATE discussions SET title = ?, turns = ?, updated_at = ? WHERE id = ?', [input.title, turnsStr, now, input.id]);
        return { id: input.id };
      }
    }
    const id = input.id || uuidv4();
    await this.run(
      'INSERT INTO discussions (id, title, turns, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, input.title, turnsStr, now, now]
    );
    return { id };
  }

  async deleteDiscussion(id: string): Promise<void> {
    await this.run('DELETE FROM discussions WHERE id = ?', [id]);
  }

  /**
   * 将实体同步到 FTS5 全文检索虚拟表
   */
  private async _syncFtsEntity(entityId: string, name: string, description: string, tags?: string[]): Promise<void> {
    try {
      // FTS5 不支持 UPSERT，先删后插
      await this.run('DELETE FROM fts_entities WHERE entity_id = ?', [entityId]);
      await this.run(
        'INSERT INTO fts_entities (entity_id, name, description, tags) VALUES (?, ?, ?, ?)',
        [entityId, name, description, tags ? tags.join(' ') : '']
      );
    } catch (e) {
      // FTS5 虚拟表可能不可用（某些 SQLite 编译版本），不阻塞主流程
      console.warn(`[FTS5] 全文索引同步失败 (${entityId}):`, e);
    }
  }

  private rowToEntity(row: any): Entity {
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

  private async _updateEntityAccess(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.run(
      `UPDATE entities
       SET last_accessed = ?, access_count = access_count + 1
       WHERE id = ?`,
      [now, id]
    );
  }

  /**
   * 批量更新实体的 access_count 和 last_accessed（隐式 access tracking）
   */
  async bumpAccessCounts(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const placeholders = ids.map(() => '?').join(',');
    await this.run(
      `UPDATE entities SET access_count = access_count + 1, last_accessed = ? WHERE id IN (${placeholders})`,
      [now, ...ids]
    );
  }

  async beginTransaction(): Promise<void> {
    await this.run('BEGIN TRANSACTION');
  }

  async commit(): Promise<void> {
    await this.run('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.run('ROLLBACK');
  }

  async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.beginTransaction();
    try {
      const result = await fn();
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  // ── 图分析洞见查询 ──

  /**
   * 按实体 type 分组统计近 N 天的访问量，用于注意力分布异常检测。
   */
  async getAccessCountByType(days: number): Promise<Array<{type: string, total_access: number, entity_count: number}>> {
    return this.all<{type: string, total_access: number, entity_count: number}>(
      `SELECT type, SUM(access_count) as total_access, COUNT(*) as entity_count
       FROM entities
       WHERE created_at > datetime('now', '-' || ? || ' days')
         AND json_extract(metadata, '$.merged_into') IS NULL
       GROUP BY type
       ORDER BY total_access DESC`,
      [days],
    );
  }

  async addMcpUsageLog(entry: {
    toolName: string;
    client?: string;
    query?: string;
    matchedEntities?: Array<{ id: string; name?: string; type?: string }>;
    success: boolean;
    error?: string;
    durationMs: number;
  }): Promise<void> {
    const id = uuidv4();
    const matched = (entry.matchedEntities || [])
      .filter((e) => e && e.id)
      .slice(0, 12)
      .map((e) => ({ id: e.id, name: e.name || '', type: e.type || '' }));

    await this.run(
      `INSERT INTO mcp_usage_log
        (id, tool_name, client, query, matched_entities, success, error, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        id,
        entry.toolName,
        entry.client || null,
        entry.query ? entry.query.slice(0, 500) : null,
        matched.length > 0 ? JSON.stringify(matched) : null,
        entry.success ? 1 : 0,
        entry.error ? entry.error.slice(0, 500) : null,
        Math.max(0, Math.round(entry.durationMs || 0)),
      ],
    );
  }

  async getRecentMcpUsage(limit: number = 20): Promise<Array<{
    id: string;
    toolName: string;
    client: string | null;
    query: string | null;
    matchedEntities: Array<{ id: string; name?: string; type?: string }>;
    success: boolean;
    error: string | null;
    durationMs: number;
    createdAt: string;
  }>> {
    const rows = await this.all<any>(
      `SELECT id, tool_name, client, query, matched_entities, success, error, duration_ms, created_at
       FROM mcp_usage_log
       ORDER BY created_at DESC
       LIMIT ?`,
      [Math.max(1, Math.min(limit, 100))],
    );
    return rows.map((row) => {
      let matchedEntities: Array<{ id: string; name?: string; type?: string }> = [];
      try {
        matchedEntities = row.matched_entities ? JSON.parse(row.matched_entities) : [];
      } catch {
        matchedEntities = [];
      }
      return {
        id: row.id,
        toolName: row.tool_name,
        client: row.client || null,
        query: row.query || null,
        matchedEntities,
        success: row.success === 1 || row.success === true,
        error: row.error || null,
        durationMs: row.duration_ms || 0,
        createdAt: row.created_at,
      };
    });
  }

  /**
   * 在实体 name/description 中搜索关键词（LIKE 模糊匹配），用于反共识洞见检测。
   */
  async searchEntityByKeyword(keyword: string, limit: number = 10): Promise<Entity[]> {
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE (name LIKE ? OR description LIKE ?)
         AND json_extract(metadata, '$.merged_into') IS NULL
       ORDER BY updated_at DESC
       LIMIT ?`,
      [`%${keyword}%`, `%${keyword}%`, limit],
    );
    return rows.map(row => this.rowToEntity(row));
  }

  async getStats(): Promise<{
    entities: number;
    relationships: number;
    principles: number;
    corePrinciples: number;
    evidence: number;
  }> {
    const entities = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM entities');
    const relationships = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM relationships');
    const principles = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM entities WHERE type = ?', ['principle']);
    const corePrinciples = await this.get<{ count: number }>(`SELECT COUNT(*) as count FROM entities WHERE type = ? AND json_extract(metadata, '$.isCore') = 1`, ['principle']);
    const evidence = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM entities WHERE type = ?', ['evidence']);

    return {
      entities: entities?.count || 0,
      relationships: relationships?.count || 0,
      principles: principles?.count || 0,
      corePrinciples: corePrinciples?.count || 0,
      evidence: evidence?.count || 0,
    };
  }
}

export function initDatabase(config: string | DatabaseConfig = './data/omni-context.db'): Database {
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
  } catch (e) {
    console.warn('[Database] sqlite-vec 扩展加载失败，将回退到 JS 内存向量搜索:', e);
  }

  return new Database(db, dbPath, vecEnabled);
}

export default initDatabase;
