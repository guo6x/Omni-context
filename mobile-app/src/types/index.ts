// 与 Brain Server 对齐的类型定义

// 由 Brain Server domain schema 生成，禁止手工维护清单。
import type { EntityType, RelationshipType } from './generated-domain';
export type { EntityType, NotificationType, RelationshipType } from './generated-domain';

// 原则类型
export type PrincipleType =
  | 'code_principle'
  | 'design_pattern'
  | 'workflow_rule'
  | 'personal_preference'
  | 'security_rule'
  | 'performance_optimization';

// 实体接口（与 Brain Server 对齐）
export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  description?: string;
  embedding?: number[];
  source_file?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  access_count: number;
  last_accessed?: string;
  synced?: boolean;
}

// 实体输入（用于创建）
export interface EntityInput {
  id?: string;
  name: string;
  type: EntityType;
  description?: string;
  source_file?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

// 关系接口
export interface Relationship {
  id: string;
  source_id: string;
  target_id: string;
  type: RelationshipType;
  description?: string;
  weight: number;
  created_at: string;
  last_activated: string;
  valid_from?: string;
  valid_until?: string;
  invalidated_at?: string;
  invalidation_reason?: string;
}

// 图谱邻域（用于实体详情）
export interface GraphNeighborhood {
  entities: Entity[];
  relationships: Relationship[];
}

// 知识图谱（用于可视化）
export interface KnowledgeNode {
  id: string;
  label: string;
  type: EntityType;
  connections: string[];
  weight: number;
  color: string;
  x?: number;
  y?: number;
}

export interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  weight: number;
  description?: string;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

// 搜索结果
export interface VectorSearchResult {
  id: string;
  name: string;
  type: EntityType;
  description?: string;
  similarity: number;
}

// 系统统计
export interface SystemStats {
  database: {
    entities: number;
    relationships: number;
    principles: number;
    corePrinciples: number;
    evidence: number;
  };
  coreMemory: {
    totalItems: number;
    categories: Record<string, number>;
  };
  archivalMemory: {
    totalItems: number;
    totalSize: number;
    topTags: string[];
  };
}

// 同步状态
export interface SyncStatus {
  lastSync: number | null;
  pending: number;
  syncing: boolean;
  error: string | null;
}

// 应用设置
export interface AppSettings {
  theme: 'dark' | 'light';
  language: 'zh' | 'en';
  syncEnabled: boolean;
  serverUrl: string;
  authToken?: string;
  autoSync: boolean;
  notificationsEnabled: boolean;
}

// HUD 消息
export interface HUDMessage {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: number;
}

// 为了向后兼容，保留 Memory 类型但标记为 deprecated
/**
 * @deprecated 使用 Entity 类型替代
 */
export interface Memory {
  id: string;
  content: string;
  type: 'note' | 'task' | 'idea' | 'reference';
  tags: string[];
  createdAt: number;
  updatedAt: number;
  synced: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * @deprecated 使用 SearchEntity 和 Entity 类型替代
 */
export interface SearchEntity {
  id: string;
  name: string;
  type: string;
  description?: string;
  tags?: string[];
  access_count?: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * @deprecated 使用 Entity 类型替代
 */
export interface ArchivalSearchItem {
  item: {
    id: string;
    content: string;
    summary?: string;
    tags?: string[];
    createdAt: string;
    archivedAt: string;
    importance?: number;
  };
  relevanceScore: number;
  matchType: string;
}

/**
 * @deprecated 使用 Entity 和 metadata.isCore 判断替代
 */
export interface CoreMemoryItem {
  key: string;
  value: any;
  category: string;
  lastAccessed: string;
  accessCount: number;
  summary?: string;
}

/**
 * @deprecated 使用统一的 Entity 搜索结果替代
 */
export interface SearchResults {
  entities: SearchEntity[];
  archival: ArchivalSearchItem[];
  core: CoreMemoryItem[];
}

// 辅助函数：将 Entity 转换为向后兼容的格式
export function entityToMemory(entity: Entity): Memory {
  const typeMap: Partial<Record<EntityType, 'note' | 'task' | 'idea' | 'reference'>> = {
    task: 'task',
    memory: 'reference',
    capture_snapshot: 'reference',
    decision: 'note',
    goal: 'idea',
    question: 'idea',
    preference: 'note',
  };
  const type = typeMap[entity.type] || 'reference';
  
  return {
    id: entity.id,
    content: entity.description || entity.name,
    type,
    tags: entity.tags || [],
    createdAt: Date.parse(entity.created_at),
    updatedAt: Date.parse(entity.updated_at),
    synced: true,
    metadata: entity.metadata,
  };
}

// 辅助函数：将向后兼容的 Memory 转换为 Entity
export function memoryToEntity(memory: Memory): EntityInput {
  const typeMap: Partial<Record<'note' | 'task' | 'idea' | 'reference', EntityType>> = {
    note: 'memory',
    task: 'task',
    idea: 'memory',
    reference: 'memory',
  };
  
  return {
    id: memory.id,
    name: memory.content.slice(0, 100), // 取前100字符作为名称
    type: typeMap[memory.type] || 'memory',
    description: memory.content,
    tags: memory.tags,
    metadata: memory.metadata,
  };
}

// 辅助函数：将 Entity 转换为 KnowledgeNode
export function entityToKnowledgeNode(entity: Entity): KnowledgeNode {
  const colorMap: Record<EntityType, string> = {
    principle: '#f97316',   // orange
    evidence: '#22c55e',    // green
    concept: '#22d3ee',     // cyan
    tool: '#a855f7',        // purple
    person: '#ec4899',      // pink
    project: '#f59e0b',     // amber
    code_snippet: '#14b8a6', // teal
    architecture_pattern: '#8b5cf6', // violet
    bug_vulnerability: '#ef4444', // red
    business_logic: '#06b6d4', // cyan
    critical_review: '#f43f5e', // rose
    capture_snapshot: '#71717a', // zinc
    memory: '#64748b',      // slate
    decision: '#3b82f6',    // blue
    goal: '#10b981',        // emerald
    question: '#fbbf24',    // yellow
    preference: '#d946ef',  // fuchsia
    event: '#8b5cf6',       // violet
    task: '#eab308',        // yellow
  };
  
  return {
    id: entity.id,
    label: entity.name,
    type: entity.type,
    connections: [],
    weight: entity.access_count || 1,
    color: colorMap[entity.type] || '#22d3ee',
  };
}

// 辅助函数：将 Relationship 转换为 KnowledgeEdge
export function relationshipToKnowledgeEdge(rel: Relationship): KnowledgeEdge {
  return {
    id: rel.id,
    source: rel.source_id,
    target: rel.target_id,
    type: rel.type,
    weight: rel.weight,
    description: rel.description,
  };
}
