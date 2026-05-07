import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { Entity, Relationship } from '../shared-types.js';

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
];

interface Migration {
  version: number;
  name: string;
  up: string;
  down?: string;
}

export class Database {
  private db: sqlite3.Database;
  private dbPath: string;

  constructor(db: sqlite3.Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  run(sql: string, params: any[] = []): Promise<sqlite3.RunResult> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    };
  }

  get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T | undefined);
      });
    };
  }

  all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    };
  }

  exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    };
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    };
  }

  getRaw(): sqlite3.Database {
    return this.db;
  }

  async runMigrations(): Promise<void> {
    for (const migration of MIGRATIONS) {
      const applied = await this.get<MigrationRecord>(
        'SELECT * FROM migrations WHERE name = ?',
        [migration.name]
      );

      if (!applied) {
        await this.exec(migration.up);
        await this.run(
          'INSERT INTO migrations (name) VALUES (?)',
          [migration.name]
        );
        console.log(`Migration applied: ${migration.name}`);
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
    const embeddingBlob = entity.embedding ? Buffer.from(new Float64Array(entity.embedding).buffer) : null;

    await this.run(
      `INSERT INTO entities (id, name, type, description, source_file, tags, embedding, metadata, created_at, updated_at, last_accessed, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, entity.name, entity.type, entity.description || null, entity.source_file || null,
       tagsStr, embeddingBlob, metadataStr, now, now, now, entity.access_count || 0]
    );

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
    await this._updateEntityAccess(id);
    const row = await this.get<any>('SELECT * FROM entities WHERE id = ?', [id]);
    if (!row) return null;
    return this.rowToEntity(row);
  }

  async getEntitiesByType(type: string): Promise<Entity[]> {
    const rows = await this.all<any>('SELECT * FROM entities WHERE type = ? ORDER BY updated_at DESC', [type]);
    return rows.map(row => this.rowToEntity(row));
  }

  async getCorePrinciples(): Promise<Entity[]> {
    const rows = await this.all<any>(`
      SELECT * FROM entities
      WHERE type = 'principle'
      AND json_extract(metadata, '$.isCore') = 1
      ORDER BY updated_at DESC
    `);
    return rows.map(row => this.rowToEntity(row));
  }

  async searchEntities(query: string, limit: number = 10): Promise<Entity[]> {
    const searchTerm = `%${query}%`;
    const rows = await this.all<any>(
      `SELECT * FROM entities
       WHERE name LIKE ? OR description LIKE ?
       ORDER BY updated_at DESC LIMIT ?`,
      [searchTerm, searchTerm, limit]
    );
    return rows.map(row => this.rowToEntity(row));
  }

  async updateEntity(id: string, updates: Partial<Omit<Entity, 'id' | 'created_at' | 'updated_at' | 'last_accessed' | 'access_count'>>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

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
      values.push(Buffer.from(new Float64Array(updates.embedding).buffer));
    }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }
    if (updates.source_file !== undefined) {
      fields.push('source_file = ?');
      values.push(updates.source_file);
    }

    if (fields.length === 0) return;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    await this.run(
      `UPDATE entities SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
  }

  async deleteEntity(id: string): Promise<void> {
    await this.run('DELETE FROM entities WHERE id = ?', [id]);
  }

  async addRelationship(relationship: Omit<Relationship, 'id' | 'created_at' | 'last_activated'> & {
    id?: string;
  }): Promise<Relationship> {
    const id = relationship.id || uuidv4();
    const now = new Date().toISOString();

    await this.run(
      `INSERT OR REPLACE INTO relationships (id, source_id, target_id, type, description, weight, created_at, last_activated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, relationship.source_id, relationship.target_id, relationship.type,
       relationship.description || null, relationship.weight || 1.0, now, now]
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
    };
  }

  async getRelationshipsForEntity(entityId: string): Promise<Relationship[]> {
    const rows = await this.all<any>(
      `SELECT * FROM relationships WHERE source_id = ? OR target_id = ? ORDER BY weight DESC`,
      [entityId, entityId]
    );
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

  async getGraphNeighborhood(entityId: string, depth: number = 1): Promise<GraphNeighborhood> {
    depth = Math.min(depth, 3);
    const nodes = new Map<string, Entity>();
    const edges: Relationship[] = [];
    const visited = new Set([entityId]);
    const queue: Array<{ id: string; d: number }> = [{ id: entityId, d: 0 }];

    const startEntity = await this.getEntity(entityId);
    if (!startEntity) return { nodes: [], edges: [] };
    nodes.set(entityId, startEntity);

    while (queue.length > 0) {
      const { id, d } = queue.shift()!;
      const rels = await this.getRelationshipsForEntity(id);
      for (const rel of rels) {
        edges.push(rel);
        const neighborId = rel.source_id === id ? rel.target_id : rel.source_id;
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          const neighborEntity = await this.getEntity(neighborId);
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
   * 向量搜索 - 当前使用纯 JS 内存计算（待优化至 sqlite-vec/sqlite-vss
   * @param queryEmbedding 搜索向量
   * @param limit 结果限制
   * @returns 搜索结果（带相似度
   */
  async vectorSearch(queryEmbedding: number[], limit: number = 10): Promise<VectorSearchResult[]> {
    const rows = await this.all<any>(
      'SELECT id, name, type, description, embedding FROM entities WHERE embedding IS NOT NULL'
    );

    const results: VectorSearchResult[] = rows
      .map(row => {
        if (!row.embedding) return null;

        const storedEmbedding = Array.from(new Float64Array(row.embedding));
        const similarity = this.cosineSimilarity(queryEmbedding, storedEmbedding);

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

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
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
      embedding: row.embedding ? Array.from(new Float64Array(row.embedding)) : undefined,
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
    const corePrinciples = await this.get<{ count: number }>('SELECT COUNT(*) as count FROM entities WHERE type = ? AND json_extract(metadata, '$.isCore') = 1', ['principle']);
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

  if (typeof config === 'object') {
    if (config.enableWAL) {
      db.run('PRAGMA journal_mode = WAL');
    }
    if (config.busyTimeout) {
      db.run(`PRAGMA busy_timeout = ${config.busyTimeout}`);
    }
  }

  return new Database(db, dbPath);
}

export default initDatabase;
