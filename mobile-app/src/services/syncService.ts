import { api } from './api';
import * as localDb from './localDb';
import { Memory, SyncStatus } from '@/types';

type SyncCallback = (status: SyncStatus) => void;

class SyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  private callbacks: Set<SyncCallback> = new Set();
  private status: SyncStatus = {
    lastSync: null,
    pending: 0,
    syncing: false,
    error: null,
  };

  subscribe(callback: SyncCallback): () => void {
    this.callbacks.add(callback);
    callback(this.status);
    return () => this.callbacks.delete(callback);
  }

  private notify(): void {
    this.callbacks.forEach(cb => cb(this.status));
  }

  private updateStatus(updates: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...updates };
    this.notify();
  }

  async initialize(): Promise<void> {
    await localDb.initDatabase();
    await this.updatePendingCount();
  }

  private async updatePendingCount(): Promise<void> {
    try {
      const unsynced = await localDb.getUnsyncedMemories();
      this.updateStatus({ pending: unsynced.length });
    } catch (error) {
      console.error('Failed to update pending count:', error);
    }
  }

  async sync(): Promise<void> {
    if (this.status.syncing) {
      return;
    }

    if (!api.isConfigured()) {
      this.updateStatus({ error: 'API not configured' });
      return;
    }

    this.updateStatus({ syncing: true, error: null });

    try {
      const unsynced = await localDb.getUnsyncedMemories();

      if (unsynced.length === 0) {
        this.updateStatus({
          syncing: false,
          lastSync: Date.now(),
          pending: 0,
        });
        return;
      }

      // 逐条上传，单条失败不阻塞其他记录；只标记真正成功的为 synced
      let successCount = 0;
      let lastError: string | null = null;
      for (const memory of unsynced) {
        const res = await api.createMemory({
          content: memory.content,
          type: memory.type,
          tags: memory.tags,
          metadata: memory.metadata,
        });
        if (res.success) {
          await localDb.markMemorySynced(memory.id);
          successCount++;
        } else {
          lastError = res.error ?? 'Sync failed';
        }
      }

      await this.updatePendingCount();
      this.updateStatus({
        syncing: false,
        lastSync: successCount > 0 ? Date.now() : this.status.lastSync,
        error: successCount === unsynced.length ? null : lastError,
      });
    } catch (error) {
      this.updateStatus({
        syncing: false,
        error: (error as Error).message,
      });
    }
  }

  async pullFromServer(): Promise<Memory[]> {
    if (!api.isConfigured()) {
      return [];
    }

    try {
      const lastSync = this.status.lastSync;
      const result = await api.getMemories(lastSync ?? undefined);

      if (!result.success || !result.data) return [];

      const merged: Memory[] = [];
      for (const incoming of result.data) {
        const local = await localDb.getMemoryById(incoming.id);
        // 冲突解决：
        //   - 没有本地记录：直接落库
        //   - 本地未同步且修改更新：保留本地（用户尚未上传的编辑优先）
        //   - 服务端 updatedAt 严格更新：覆盖
        //   - 否则保持本地不变
        if (!local) {
          await localDb.addMemory({ ...incoming, synced: true });
          merged.push(incoming);
          continue;
        }
        if (!local.synced && local.updatedAt >= (incoming.updatedAt ?? 0)) {
          continue;
        }
        if ((incoming.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
          await localDb.addMemory({ ...incoming, synced: true });
          merged.push(incoming);
        }
      }
      await this.updatePendingCount();
      return merged;
    } catch (error) {
      console.error('Failed to pull from server:', error);
      return [];
    }
  }

  async fullSync(): Promise<void> {
    await this.sync();
    await this.pullFromServer();
  }

  startAutoSync(intervalMs: number = 60000): void {
    this.stopAutoSync();
    this.syncInterval = setInterval(() => {
      this.sync();
    }, intervalMs);
  }

  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  async addMemory(memory: Memory): Promise<void> {
    await localDb.addMemory(memory);
    await this.updatePendingCount();

    if (api.isConfigured() && !memory.synced) {
      // sync() 内部已捕获错误并写入 status.error；
      // 这里仍包一层 catch，防止 unhandled rejection 出现在 RN 红屏
      this.sync().catch((err) => {
        console.warn('Background sync failed:', err);
        this.updateStatus({ error: (err as Error).message });
      });
    }
  }

  async updateMemory(id: string, updates: Partial<Memory>): Promise<void> {
    await localDb.updateMemory(id, updates);
    await this.updatePendingCount();
  }

  async deleteMemory(id: string): Promise<void> {
    await localDb.deleteMemory(id);
    await this.updatePendingCount();
    
    if (api.isConfigured()) {
      await api.deleteMemory(id);
    }
  }

  async getMemories(limit?: number, offset?: number): Promise<Memory[]> {
    return localDb.getMemories(limit, offset);
  }

  async searchMemories(query: string): Promise<Memory[]> {
    return localDb.searchMemories(query);
  }
}

export const syncService = new SyncService();
