import * as SQLite from 'expo-sqlite';
import { Memory, KnowledgeNode, KnowledgeEdge } from '@/types';

let db: SQLite.SQLiteDatabase | null = null;

export async function initDatabase(): Promise<void> {
  db = await SQLite.openDatabaseAsync('omni_context.db');
  
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      tags TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      synced INTEGER DEFAULT 0,
      metadata TEXT
    );
    
    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      connections TEXT NOT NULL,
      weight REAL NOT NULL,
      color TEXT NOT NULL,
      x REAL,
      y REAL
    );
    
    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(createdAt);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_synced ON memories(synced);
  `);
}

export async function addMemory(memory: Memory): Promise<void> {
  if (!db) throw new Error('Database not initialized');
  
  await db.runAsync(
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
  if (!db) throw new Error('Database not initialized');
  
  const results = await db.getAllAsync<any>(
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
  if (!db) throw new Error('Database not initialized');
  
  const result = await db.getFirstAsync<any>(
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
  if (!db) throw new Error('Database not initialized');
  
  await db.runAsync(`DELETE FROM memories WHERE id = ?`, [id]);
}

export async function getUnsyncedMemories(): Promise<Memory[]> {
  if (!db) throw new Error('Database not initialized');
  
  const results = await db.getAllAsync<any>(
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
  if (!db) throw new Error('Database not initialized');
  
  await db.runAsync(
    `UPDATE memories SET synced = 1 WHERE id = ?`,
    [id]
  );
}

export async function searchMemories(query: string): Promise<Memory[]> {
  if (!db) throw new Error('Database not initialized');
  
  const results = await db.getAllAsync<any>(
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
  if (!db) throw new Error('Database not initialized');
  
  await db.runAsync(
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
  if (!db) throw new Error('Database not initialized');
  
  const results = await db.getAllAsync<any>(
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
  if (!db) throw new Error('Database not initialized');
  
  await db.runAsync(
    `INSERT OR REPLACE INTO knowledge_edges (id, source, target, type, weight)
     VALUES (?, ?, ?, ?, ?)`,
    [edge.id, edge.source, edge.target, edge.type, edge.weight]
  );
}

export async function getKnowledgeEdges(): Promise<KnowledgeEdge[]> {
  if (!db) throw new Error('Database not initialized');
  
  const results = await db.getAllAsync<any>(
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
  if (!db) throw new Error('Database not initialized');
  
  await db.execAsync(`
    DELETE FROM memories;
    DELETE FROM knowledge_nodes;
    DELETE FROM knowledge_edges;
  `);
}
