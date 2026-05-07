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

      const result = await api.syncMemories(unsynced);

      if (result.success && result.data) {
        for (const memory of unsynced) {
          await localDb.markMemorySynced(memory.id);
        }

        this.updateStatus({
          syncing: false,
          lastSync: Date.now(),
          pending: 0,
        });
      } else {
        this.updateStatus({
          syncing: false,
          error: result.error ?? 'Sync failed',
        });
      }
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

      if (result.success && result.data) {
        for (const memory of result.data) {
          await localDb.addMemory({
            ...memory,
            synced: true,
          });
        }
        return result.data;
      }
      return [];
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
      this.sync();
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
