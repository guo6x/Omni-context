import axios, { AxiosInstance, AxiosError } from 'axios';
import { Memory, KnowledgeGraph, SyncStatus } from '@/types';

interface ApiConfig {
  baseUrl: string;
  timeout?: number;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

class ApiClient {
  private client: AxiosInstance | null = null;
  private baseUrl: string = '';

  configure(config: ApiConfig): void {
    this.baseUrl = config.baseUrl;
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeout ?? 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      response => response,
      (error: AxiosError) => {
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
      const response = await this.client.post('/api/memories/sync', { memories });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async getMemories(since?: number): Promise<ApiResponse<Memory[]>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const params = since ? { since } : {};
      const response = await this.client.get('/api/memories', { params });
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async createMemory(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'synced'>): Promise<ApiResponse<Memory>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.post('/api/memories', memory);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async updateMemory(id: string, updates: Partial<Memory>): Promise<ApiResponse<Memory>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.put(`/api/memories/${id}`, updates);
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async deleteMemory(id: string): Promise<ApiResponse<void>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      await this.client.delete(`/api/memories/${id}`);
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
      const response = await this.client.get('/api/knowledge-graph');
      return { success: true, data: response.data };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async getSyncStatus(): Promise<ApiResponse<SyncStatus>> {
    if (!this.client) {
      return { success: false, error: 'API client not configured' };
    }

    try {
      const response = await this.client.get('/api/sync/status');
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
      const response = await this.client.get('/api/memories/search', {
        params: { q: query },
      });
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
