import * as SQLite from 'expo-sqlite';
import {
  Entity,
  EntityInput,
  Relationship,
  KnowledgeNode,
  KnowledgeEdge,
  entityToKnowledgeNode,
  relationshipToKnowledgeEdge,
} from '@/types';

let db: SQLite.SQLiteDatabase | null = null;

export async function initDatabase(): Promise<void> {
  db = SQLite.openDatabase('omni_context.db');
  
  await execStatements([
    'PRAGMA journal_mode = WAL',
    // 实体表
    `CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      source_file TEXT,
      tags TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed TEXT,
      synced INTEGER DEFAULT 0
    )`,
    // 关系表
    `CREATE TABLE IF NOT EXISTS relationships (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      weight REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      last_activated TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      invalidated_at TEXT,
      invalidation_reason TEXT
    )`,
    // 知识节点表（用于可视化）
    `CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      connections TEXT NOT NULL,
      weight REAL NOT NULL,
      color TEXT NOT NULL,
      x REAL,
      y REAL
    )`,
    // 知识边表
    `CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL NOT NULL,
      description TEXT
    )`,
    // 索引
    'CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)',
    'CREATE INDEX IF NOT EXISTS idx_entities_created ON entities(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_entities_updated ON entities(updated_at)',
    'CREATE INDEX IF NOT EXISTS idx_entities_synced ON entities(synced)',
    'CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(source_id)',
    'CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(target_id)',
  ]);
}

function getDb(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('Database not initialized');
  return db;
}

async function execute(sql: string, args: unknown[] = [], readOnly = false): Promise<SQLite.ResultSet> {
  const [result] = await getDb().execAsync([{ sql, args }], readOnly);
  if ('error' in result) {
    throw result.error;
  }
  return result;
}

async function execStatements(statements: string[]): Promise<void> {
  for (const statement of statements) {
    await execute(statement);
  }
}

async function runAsync(sql: string, args: unknown[] = []): Promise<SQLite.ResultSet> {
  return execute(sql, args);
}

async function getAllAsync<T>(sql: string, args: unknown[] = []): Promise<T[]> {
  const result = await execute(sql, args, true);
  return result.rows as T[];
}

async function getFirstAsync<T>(sql: string, args: unknown[] = []): Promise<T | null> {
  const rows = await getAllAsync<T>(sql, args);
  return rows[0] ?? null;
}

// ============ 实体相关操作 ============

export async function addEntity(entity: Entity | EntityInput, synced: boolean = false): Promise<void> {
  const now = new Date().toISOString();
  const entityWithDefaults: Entity = {
    id: 'id' in entity && entity.id ? entity.id : crypto.randomUUID(),
    name: entity.name,
    type: entity.type,
    description: entity.description,
    source_file: 'source_file' in entity ? entity.source_file : undefined,
    tags: entity.tags,
    metadata: entity.metadata,
    created_at: 'created_at' in entity && entity.created_at ? entity.created_at : now,
    updated_at: 'updated_at' in entity && entity.updated_at ? entity.updated_at : now,
    access_count: 'access_count' in entity && entity.access_count ? entity.access_count : 0,
    last_accessed: 'last_accessed' in entity ? entity.last_accessed : undefined,
  };

  await runAsync(
    `INSERT OR REPLACE INTO entities (
      id, name, type, description, source_file, tags, metadata,
      created_at, updated_at, access_count, last_accessed, synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entityWithDefaults.id,
      entityWithDefaults.name,
      entityWithDefaults.type,
      entityWithDefaults.description || null,
      entityWithDefaults.source_file || null,
      entityWithDefaults.tags ? JSON.stringify(entityWithDefaults.tags) : null,
      entityWithDefaults.metadata ? JSON.stringify(entityWithDefaults.metadata) : null,
      entityWithDefaults.created_at,
      entityWithDefaults.updated_at,
      entityWithDefaults.access_count,
      entityWithDefaults.last_accessed || null,
      synced ? 1 : 0,
    ]
  );
}

export async function getEntities(limit = 100, offset = 0): Promise<Entity[]> {
  const results = await getAllAsync<any>(
    `SELECT * FROM entities ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  
  return results.map(row => rowToEntity(row));
}

export async function getEntity(id: string): Promise<Entity | null> {
  const result = await getFirstAsync<any>(
    `SELECT * FROM entities WHERE id = ?`,
    [id]
  );
  
  if (!result) return null;
  
  return rowToEntity(result);
}

export async function updateEntity(id: string, updates: Partial<Entity>): Promise<void> {
  const existing = await getEntity(id);
  if (!existing) throw new Error('Entity not found');

  const updatedEntity: Entity = {
    ...existing,
    ...updates,
    id,
    updated_at: new Date().toISOString(),
  };

  await addEntity(updatedEntity);
}

export async function deleteEntity(id: string): Promise<void> {
  await runAsync(`DELETE FROM entities WHERE id = ?`, [id]);
}

export async function getUnsyncedEntities(): Promise<Entity[]> {
  const results = await getAllAsync<any>(
    `SELECT * FROM entities WHERE synced = 0`
  );
  
  return results.map(row => rowToEntity(row));
}

export async function markEntitySynced(id: string): Promise<void> {
  await runAsync(
    `UPDATE entities SET synced = 1 WHERE id = ?`,
    [id]
  );
}

export async function searchEntitiesLocal(query: string): Promise<Entity[]> {
  const results = await getAllAsync<any>(
    `SELECT * FROM entities WHERE name LIKE ? OR description LIKE ? ORDER BY created_at DESC`,
    [`%${query}%`, `%${query}%`]
  );
  
  return results.map(row => rowToEntity(row));
}

function rowToEntity(row: any): Entity {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description,
    source_file: row.source_file,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    access_count: row.access_count || 0,
    last_accessed: row.last_accessed,
  };
}

// ============ 关系相关操作 ============

export async function addRelationship(rel: Relationship): Promise<void> {
  await runAsync(
    `INSERT OR REPLACE INTO relationships (
      id, source_id, target_id, type, description, weight,
      created_at, last_activated, valid_from, valid_until,
      invalidated_at, invalidation_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rel.id,
      rel.source_id,
      rel.target_id,
      rel.type,
      rel.description || null,
      rel.weight,
      rel.created_at,
      rel.last_activated,
      rel.valid_from || null,
      rel.valid_until || null,
      rel.invalidated_at || null,
      rel.invalidation_reason || null,
    ]
  );
}

export async function getRelationshipsForEntity(entityId: string): Promise<Relationship[]> {
  const results = await getAllAsync<any>(
    `SELECT * FROM relationships WHERE source_id = ? OR target_id = ?`,
    [entityId, entityId]
  );
  
  return results.map(row => ({
    id: row.id,
    source_id: row.source_id,
    target_id: row.target_id,
    type: row.type,
    description: row.description,
    weight: row.weight,
    created_at: row.created_at,
    last_activated: row.last_activated,
    valid_from: row.valid_from,
    valid_until: row.valid_until,
    invalidated_at: row.invalidated_at,
    invalidation_reason: row.invalidation_reason,
  }));
}

// ============ 知识图谱可视化相关 ============

export async function addKnowledgeNode(node: KnowledgeNode): Promise<void> {
  await runAsync(
    `INSERT OR REPLACE INTO knowledge_nodes (
      id, label, type, connections, weight, color, x, y
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      node.id,
      node.label,
      node.type,
      JSON.stringify(node.connections),
      node.weight,
      node.color,
      node.x || null,
      node.y || null,
    ]
  );
}

export async function getKnowledgeNodes(): Promise<KnowledgeNode[]> {
  const results = await getAllAsync<any>(
    `SELECT * FROM knowledge_nodes`
  );
  
  return results.map(row => ({
    id: row.id,
    label: row.label,
    type: row.type,
    connections: JSON.parse(row.connections),
    weight: row.weight,
    color: row.color,
    x: row.x,
    y: row.y,
  }));
}

export async function addKnowledgeEdge(edge: KnowledgeEdge): Promise<void> {
  await runAsync(
    `INSERT OR REPLACE INTO knowledge_edges (
      id, source, target, type, weight, description
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      edge.id,
      edge.source,
      edge.target,
      edge.type,
      edge.weight,
      edge.description || null,
    ]
  );
}

export async function getKnowledgeEdges(): Promise<KnowledgeEdge[]> {
  const results = await getAllAsync<any>(
    `SELECT * FROM knowledge_edges`
  );
  
  return results.map(row => ({
    id: row.id,
    source: row.source,
    target: row.target,
    type: row.type,
    weight: row.weight,
    description: row.description,
  }));
}

// ============ 同步辅助：从服务器数据更新本地 ============

export async function syncFromServer(
  serverEntities: Entity[],
  serverRelationships: Relationship[]
): Promise<void> {
  // 简单版本，不用事务
  // 保存实体，从服务器来的都是已同步的
  for (const entity of serverEntities) {
    await addEntity(entity, true);
  }
  
  // 保存关系
  for (const rel of serverRelationships) {
    await addRelationship(rel);
  }
  
  // 更新知识图谱节点
  for (const entity of serverEntities) {
    await addKnowledgeNode(entityToKnowledgeNode(entity));
  }
  
  // 更新知识图谱边
  for (const rel of serverRelationships) {
    await addKnowledgeEdge(relationshipToKnowledgeEdge(rel));
  }
}

export async function clearAllData(): Promise<void> {
  await execStatements([
    'DELETE FROM entities',
    'DELETE FROM relationships',
    'DELETE FROM knowledge_nodes',
    'DELETE FROM knowledge_edges',
  ]);
}
