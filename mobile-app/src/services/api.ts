import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  Entity,
  EntityInput,
  Relationship,
  GraphNeighborhood,
  KnowledgeGraph,
  SystemStats,
  VectorSearchResult,
  KnowledgeNode,
  KnowledgeEdge,
  entityToKnowledgeNode,
  relationshipToKnowledgeEdge,
} from '@/types';

// 通用 API 响应
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}



class ApiClient {
  private client: AxiosInstance | null = null;
  private baseUrl: string = '';
  private authToken: string = '';

  configure(config: { baseUrl: string; timeout?: number; authToken?: string }) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.authToken = config.authToken || '';
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: config.timeout ?? 30000,
      headers,
    });

    this.client.interceptors.response.use(
      (response) => response,
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

  reset() {
    this.client = null;
    this.baseUrl = '';
    this.authToken = '';
  }

  setAuthToken(token: string) {
    this.authToken = token;
    if (this.client) {
      this.client.defaults.headers.common['Authorization'] = token ? `Bearer ${token}` : '';
    }
  }

  clearAuthToken() {
    this.authToken = '';
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

  // ============ 实体相关 API ============

  async getEntities(params?: {
    limit?: number;
    offset?: number;
    type?: string;
    source?: string;
    q?: string;
  }): Promise<ApiResponse<Entity[]>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const queryParams = new URLSearchParams();
      if (params?.limit?.toString()) queryParams.set('limit', params.limit.toString());
      if (params?.offset?.toString()) queryParams.set('offset', params.offset.toString());
      if (params?.type) queryParams.set('type', params.type);
      if (params?.source) queryParams.set('source', params.source);
      if (params?.q) queryParams.set('q', params.q);

      const url: string = `/api/entities?${queryParams.toString()}`;
      const response = await this.client.get(url);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async getEntity(id: string): Promise<ApiResponse<{ entity: Entity; relationships: Relationship[] }>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.get(`/api/entities/${id}`);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async addEntity(entity: EntityInput): Promise<ApiResponse<Entity>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.post('/api/entities', entity);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async updateEntity(
    id: string,
    updates: Partial<Omit<Entity, 'id' | 'created_at' | 'updated_at' | 'last_accessed'>>
  ): Promise<ApiResponse<void>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      await this.client.put(`/api/entities/${id}`, updates);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async deleteEntity(id: string): Promise<ApiResponse<void>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      await this.client.delete(`/api/entities/${id}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // ============ 搜索相关 API ============

  async searchEntities(query: string, limit?: number): Promise<ApiResponse<Entity[]>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.post('/api/entities/search', { query, limit });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async searchArchival(query: string, limit?: number): Promise<ApiResponse<any[]>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.post('/api/memory/archival/search', { query, limit });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async searchCore(query: string, limit?: number): Promise<ApiResponse<any[]>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.post('/api/memory/core/search', { query, limit });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // ============ 关系相关 API ============

  async getRelationshipsForEntity(
    entityId: string,
    includeHistorical?: boolean
  ): Promise<ApiResponse<Relationship[]>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const res = await this.getEntity(entityId);
      if (res.success && res.data) {
        return { success: true, data: res.data.relationships };
      }
      return { success: false, error: res.error || 'Failed to get relationships' };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async getGraphNeighborhood(
    entityId: string, depth?: number, includeHistorical?: boolean): Promise<ApiResponse<GraphNeighborhood>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const params = new URLSearchParams();
      if (depth) params.set('depth', depth.toString());
      if (includeHistorical) params.set('includeHistorical', 'true');
      const response = await this.client.get(
        `/api/entities/${entityId}/neighborhood?${params.toString()}`
      );
      const data = response.data;
      return {
        success: true,
        data: {
          entities: data.entities || data.nodes || [],
          relationships: data.relationships || data.edges || [],
        }
      };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // ============ 知识图谱 API ============

  async getKnowledgeGraph(): Promise<ApiResponse<KnowledgeGraph>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      // 获取所有实体和关系来构建图谱
      const [entitiesRes, relationshipsRes] = await Promise.all([
        this.client.get('/api/entities?limit=1000'),
        this.client.get('/api/relationships?limit=2000'),
      ]);

      const entities: Entity[] = entitiesRes.data;
      const relationships: Relationship[] = relationshipsRes.data;

      // 构建 connections
      const nodeMap = new Map<string, string[]>();
      relationships.forEach(rel => {
        if (!nodeMap.has(rel.source_id)) nodeMap.set(rel.source_id, []);
        if (!nodeMap.has(rel.target_id)) nodeMap.set(rel.target_id, []);
        nodeMap.get(rel.source_id)!.push(rel.target_id);
        nodeMap.get(rel.target_id)!.push(rel.source_id);
      });

      const nodes: KnowledgeNode[] = entities.map(entity => ({
        ...entityToKnowledgeNode(entity),
        connections: nodeMap.get(entity.id) || [],
      }));

      const edges: KnowledgeEdge[] = relationships.map(rel => relationshipToKnowledgeEdge(rel));

      return {
        success: true,
        data: { nodes, edges } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  // ============ 统计 API ============

  async getStats(): Promise<ApiResponse<SystemStats>> {
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

  getBaseUrl(): string {
    return this.baseUrl;
  }

  isConfigured(): boolean {
    return this.client !== null && this.baseUrl.length > 0;
  }
}

export const api = new ApiClient();
