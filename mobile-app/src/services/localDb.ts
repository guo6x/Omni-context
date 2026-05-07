import * as SQLite from 'expo-sqlite';
import { Memory, KnowledgeNode, KnowledgeEdge } from '@/types';

let db: SQLite.SQLiteDatabase | null = null;

export async function initDatabase(): Promise<void> {
  db = SQLite.openDatabase('omni_context.db');
  
  await execStatements([
    'PRAGMA journal_mode = WAL',
    `CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      tags TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      synced INTEGER DEFAULT 0,
      metadata TEXT
    )`,
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
    `CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)',
    'CREATE INDEX IF NOT EXISTS idx_memories_synced ON memories(synced)',
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

export async function addMemory(memory: Memory): Promise<void> {
  await runAsync(
    `INSERT OR REPLACE INTO memories (id, content, type, tags, createdAt, updatedAt, synced, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      memory.id,
      memory.content,
      memory.type,
      JSON.stringify(memory.tags),
      memory.createdAt,
      memory.updatedAt,
      memory.synced ? 1 : 0,
      memory.metadata ? JSON.stringify(memory.metadata) : null,
    ]
  );
}

export async function getMemories(limit = 50, offset = 0): Promise<Memory[]> {
  const results = await getAllAsync<any>(
    `SELECT * FROM memories ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  
  return results.map(row => ({
    id: row.id,
    content: row.content,
    type: row.type,
    tags: JSON.parse(row.tags),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    synced: row.synced === 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }));
}

export async function getMemoryById(id: string): Promise<Memory | null> {
  const result = await getFirstAsync<any>(
    `SELECT * FROM memories WHERE id = ?`,
    [id]
  );
  
  if (!result) return null;
  
  return {
    id: result.id,
    content: result.content,
    type: result.type,
    tags: JSON.parse(result.tags),
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
    synced: result.synced === 1,
    metadata: result.metadata ? JSON.parse(result.metadata) : undefined,
  };
}

export async function updateMemory(id: string, updates: Partial<Memory>): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  const memory = await getMemoryById(id);
  if (!memory) throw new Error('Memory not found');
  
  const updatedMemory = {
    ...memory,
    ...updates,
    updatedAt: Date.now(),
    synced: false,
  };
  
  await addMemory(updatedMemory);
}

export async function deleteMemory(id: string): Promise<void> {
  await runAsync(`DELETE FROM memories WHERE id = ?`, [id]);
}

export async function getUnsyncedMemories(): Promise<Memory[]> {
  const results = await getAllAsync<any>(
    `SELECT * FROM memories WHERE synced = 0`
  );
  
  return results.map(row => ({
    id: row.id,
    content: row.content,
    type: row.type,
    tags: JSON.parse(row.tags),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    synced: false,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }));
}

export async function markMemorySynced(id: string): Promise<void> {
  await runAsync(
    `UPDATE memories SET synced = 1 WHERE id = ?`,
    [id]
  );
}

export async function searchMemories(query: string): Promise<Memory[]> {
  const results = await getAllAsync<any>(
    `SELECT * FROM memories WHERE content LIKE ? ORDER BY createdAt DESC`,
    [`%${query}%`]
  );
  
  return results.map(row => ({
    id: row.id,
    content: row.content,
    type: row.type,
    tags: JSON.parse(row.tags),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    synced: row.synced === 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }));
}

export async function addKnowledgeNode(node: KnowledgeNode): Promise<void> {
  await runAsync(
    `INSERT OR REPLACE INTO knowledge_nodes (id, label, type, connections, weight, color, x, y)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      node.id,
      node.label,
      node.type,
      JSON.stringify(node.connections),
      node.weight,
      node.color,
      node.x ?? null,
      node.y ?? null,
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
    x: row.x ?? undefined,
    y: row.y ?? undefined,
  }));
}

export async function addKnowledgeEdge(edge: KnowledgeEdge): Promise<void> {
  await runAsync(
    `INSERT OR REPLACE INTO knowledge_edges (id, source, target, type, weight)
     VALUES (?, ?, ?, ?, ?)`,
    [edge.id, edge.source, edge.target, edge.type, edge.weight]
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
  }));
}

export async function clearAllData(): Promise<void> {
  await execStatements([
    'DELETE FROM memories',
    'DELETE FROM knowledge_nodes',
    'DELETE FROM knowledge_edges',
  ]);
}
