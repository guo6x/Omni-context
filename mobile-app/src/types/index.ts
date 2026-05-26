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

export interface KnowledgeNode {
  id: string;
  label: string;
  type: 'concept' | 'entity' | 'topic';
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
  type: 'relates_to' | 'depends_on' | 'part_of';
  weight: number;
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export interface SyncStatus {
  lastSync: number | null;
  pending: number;
  syncing: boolean;
  error: string | null;
}

export interface AppSettings {
  theme: 'dark' | 'light';
  language: 'zh' | 'en';
  syncEnabled: boolean;
  serverUrl: string;
  autoSync: boolean;
  notificationsEnabled: boolean;
  pairCode: string;
  pairHost: string;
  pairPort: number;
}

export interface HUDMessage {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: number;
}

// Search types
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

export interface CoreMemoryItem {
  key: string;
  value: any;
  category: string;
  lastAccessed: string;
  accessCount: number;
  summary?: string;
}

export interface SearchResults {
  entities: SearchEntity[];
  archival: ArchivalSearchItem[];
  core: CoreMemoryItem[];
}
