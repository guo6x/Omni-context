import axios, { AxiosInstance, AxiosError } from 'axios';
import { Memory, KnowledgeGraph, SyncStatus } from '@/types';

interface ApiConfig {
  baseUrl: string;
  timeout?: number;
  authToken?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ArchivalMemoryResponse {
  id: string;
  content: string;
  summary?: string;
  tags?: string[];
  createdAt: string;
  archivedAt: string;
  importance?: number;
}

class ApiClient {
  private client: AxiosInstance | null = null;
  private baseUrl: string = '';

  configure(config: ApiConfig): void {
    this.baseUrl = config.baseUrl;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.authToken) {
      headers['Authorization'] = `Bearer ${config.authToken}`;
    }
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 30000,
      headers,
    });

    this.client.interceptors.response.use(
      response => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          return Promise.reject(new Error('PAIR_CODE_EXPIRED'));
        }
        const message = error.response?.data
          ? JSON.stringify(error.response.data)
          : error.message;
        return Promise.reject(new Error(`API Error: ${message}`));
      }
    );
  }

  setAuthToken(token: string): void {
    if (this.client) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
  }

  clearAuthToken(): void {
    if (this.client) {
      delete this.client.defaults.headers.common['Authorization'];
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.client) return false;
    
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async syncMemories(memories: Memory[]): Promise<ApiResponse<{ synced: number }>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      let syncedCount = 0;
      for (const memory of memories) {
        await this.client.post('/api/memory/archival', {
          content: memory.content,
          tags: ['mobile', memory.type, ...memory.tags],
          importance: memory.type === 'task' ? 0.8 : 0.5,
        });
        syncedCount++;
      }
      return { success: true, data: { synced: syncedCount } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async getMemories(since?: number): Promise<ApiResponse<Memory[]>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      // Server endpoint 现暂不支持 since 增量过滤，先在客户端按时间裁剪
      const response = await this.client.get('/api/memory/archival');
      let items = (response.data as ArchivalMemoryResponse[]) || [];
      if (typeof since === 'number') {
        items = items.filter((item) => {
          const ts = Date.parse(item.archivedAt || item.createdAt || '') || 0;
          return ts >= since;
        });
      }
      const memories = items.map((item) => this.mapArchivalMemory(item));
      return { success: true, data: memories };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async createMemory(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'synced'>): Promise<ApiResponse<Memory>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.post('/api/memory/archival', {
        content: memory.content,
        tags: [memory.type, ...memory.tags],
        importance: memory.type === 'task' ? 0.8 : 0.5,
      });
      return { success: true, data: this.mapArchivalMemory(response.data) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async updateMemory(id: string, updates: Partial<Memory>): Promise<ApiResponse<Memory>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.put(`/api/memory/archival/${id}`, {
        content: updates.content,
        tags: updates.tags,
        importance: updates.type === 'task' ? 0.8 : undefined,
      });
      return { success: true, data: this.mapArchivalMemory(response.data) };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async deleteMemory(id: string): Promise<ApiResponse<void>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      await this.client.delete(`/api/memory/archival/${id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async getKnowledgeGraph(): Promise<ApiResponse<KnowledgeGraph>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.get('/api/graph/context');
      const entities = response.data?.entities || [];
      const relationships = response.data?.relationships || [];
      return {
        success: true,
        data: {
          nodes: entities.map((entity: any) => ({
            id: entity.id,
            label: entity.name,
            type: entity.type === 'concept' ? 'concept' : 'entity',
            connections: relationships
              .filter((rel: any) => rel.source_id === entity.id || rel.target_id === entity.id)
              .map((rel: any) => rel.source_id === entity.id ? rel.target_id : rel.source_id),
            weight: entity.access_count || 1,
            color: '#22d3ee',
          })),
          edges: relationships.map((rel: any) => ({
            id: rel.id,
            source: rel.source_id,
            target: rel.target_id,
            type: rel.type === 'depends_on' || rel.type === 'part_of' ? rel.type : 'relates_to',
            weight: rel.weight || 1,
          })),
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async getSyncStatus(): Promise<ApiResponse<SyncStatus>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.get('/api/stats');
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async searchMemories(query: string): Promise<ApiResponse<Memory[]>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.post('/api/memory/archival/search', {
        query,
        limit: 50,
      });
      const memories = (response.data || [])
        .map((result: any) => this.mapArchivalMemory(result.item || result));
      return { success: true, data: memories };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async searchEntities(query: string, limit: number = 5): Promise<ApiResponse<any[]>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.post('/api/entities/search', {
        query,
        limit,
      });
      return { success: true, data: response.data as any[] };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async searchArchival(query: string, limit: number = 5): Promise<ApiResponse<any[]>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.post('/api/memory/archival/search', {
        query,
        limit,
      });
      return { success: true, data: response.data as any[] };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async searchCore(query: string, limit: number = 5): Promise<ApiResponse<any[]>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.post('/api/memory/core/search', {
        query,
        limit,
      });
      return { success: true, data: response.data as any[] };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async getEntityGraphContext(entityId: string): Promise<ApiResponse<{ entities: any[]; relationships: any[] }>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.post('/api/graph/context', {
        entity_ids: [entityId],
      });
      return {
        success: true,
        data: {
          entities: response.data?.entities || [],
          relationships: response.data?.relationships || [],
        },
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  isConfigured(): boolean {
    return this.client !== null && this.baseUrl.length > 0;
  }

  private mapArchivalMemory(item: ArchivalMemoryResponse): Memory {
    const tags = item.tags || [];
    const knownTypes = ['note', 'task', 'idea', 'reference'] as const;
    const type = knownTypes.find((candidate) => tags.includes(candidate)) || 'reference';
    const createdAt = Date.parse(item.createdAt || item.archivedAt || '') || Date.now();

    return {
      id: item.id,
      content: item.content,
      type,
      tags: tags.filter((tag) => !knownTypes.includes(tag as any) && tag !== 'mobile'),
      createdAt,
      updatedAt: createdAt,
      synced: true,
      metadata: {
        summary: item.summary,
        importance: item.importance,
      },
    };
  }
}

export const api = new ApiClient();
