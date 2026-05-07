import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

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
];

export class Database {
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  exec(sql) {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  getRaw() {
    return this.db;
  }

  async runMigrations() {
    for (const migration of MIGRATIONS) {
      const applied = await this.get('SELECT * FROM migrations WHERE name = ?', [migration.name]);
      
      if (!applied) {
        await this.exec(migration.up);
        await this.run('INSERT INTO migrations (name) VALUES (?)', [migration.name]);
        console.log(`Migration applied: ${migration.name}`);
      }
    }
  }

  async addEntity(entity) {
    const id = entity.id || uuidv4();
    const now = new Date().toISOString();
    const tagsStr = entity.tags ? JSON.stringify(entity.tags) : null;
    const metadataStr = entity.metadata ? JSON.stringify(entity.metadata) : null;
    const embeddingBlob = entity.embedding ? Buffer.from(new Float64Array(entity.embedding).buffer) : null;

    await this.run(
      `INSERT INTO entities (id, name, type, description, source_file, tags, embedding, metadata, created_at, updated_at, last_accessed, access_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, entity.name, entity.type, entity.description || null, entity.source_file || null, tagsStr, embeddingBlob, metadataStr, now, now, now, entity.access_count || 0]
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

  async getEntity(id) {
    await this._updateEntityAccess(id);
    const row = await this.get('SELECT * FROM entities WHERE id = ?', [id]);
    if (!row) return null;
    return this.rowToEntity(row);
  }

  async getEntitiesByType(type) {
    const rows = await this.all('SELECT * FROM entities WHERE type = ? ORDER BY updated_at DESC', [type]);
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
    const searchTerm = `%${query}%`;
    const rows = await this.all(
      `SELECT * FROM entities WHERE name LIKE ? OR description LIKE ? ORDER BY updated_at DESC LIMIT ?`,
      [searchTerm, searchTerm, limit]
    );
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

  async deleteEntity(id) {
    await this.run('DELETE FROM entities WHERE id = ?', [id]);
  }

  async addRelationship(relationship) {
    const id = relationship.id || uuidv4();
    const now = new Date().toISOString();

    await this.run(
      `INSERT OR REPLACE INTO relationships (id, source_id, target_id, type, description, weight, created_at, last_activated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, relationship.source_id, relationship.target_id, relationship.type, relationship.description || null, relationship.weight || 1.0, now, now]
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

  async getRelationshipsForEntity(entityId) {
    const rows = await this.all(
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

  async getGraphNeighborhood(entityId, depth = 1) {
    depth = Math.min(depth, 3);
    const nodes = new Map();
    const edges = [];
    const visited = new Set([entityId]);
    const queue = [{ id: entityId, d: 0 }];

    const startEntity = await this.getEntity(entityId);
    if (!startEntity) return { nodes: [], edges: [] };
    nodes.set(entityId, startEntity);

    while (queue.length > 0) {
      const { id, d } = queue.shift();
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

  async updateRelationshipWeight(relId, weightChange = 0.1) {
    const now = new Date().toISOString();
    await this.run(
      `UPDATE relationships 
       SET weight = weight + ?, last_activated = ? 
       WHERE id = ?`,
      [weightChange, now, relId]
    );
  }

  async deleteRelationship(id) {
    await this.run('DELETE FROM relationships WHERE id = ?', [id]);
  }

  // FIXME: P0 - 迁移至 sqlite-vec 或 sqlite-vss 扩展实现原生向量搜索
  // 当前实现将所有 embedding 数据加载到内存，纯 JavaScript 计算余弦相似度
  async vectorSearch(queryEmbedding, limit = 10) {
    const rows = await this.all('SELECT id, name, type, description, embedding FROM entities WHERE embedding IS NOT NULL');

    const results = rows
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
      .filter(r => r !== null)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  cosineSimilarity(a, b) {
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
      embedding: row.embedding ? Array.from(new Float64Array(row.embedding)) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      last_accessed: row.last_accessed,
      access_count: row.access_count,
    };
  }

  async _updateEntityAccess(id) {
    const now = new Date().toISOString();
    await this.run(`UPDATE entities SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?`, [now, id]);
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
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }

  async getStats() {
    const entities = await this.get('SELECT COUNT(*) as count FROM entities');
    const relationships = await this.get('SELECT COUNT(*) as count FROM relationships');
    const principles = await this.get('SELECT COUNT(*) as count FROM entities WHERE type = ?', ['principle']);
    const corePrinciples = await this.get('SELECT COUNT(*) as count FROM entities WHERE type = ? AND json_extract(metadata, '$.isCore') = 1', ['principle']);
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
