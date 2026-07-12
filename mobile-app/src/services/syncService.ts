import { api } from './api';
import * as localDb from './localDb';
import { Entity, Relationship, SyncStatus } from '@/types';

type SyncCallback = (status: SyncStatus) => void;
const READ_ONLY_ERROR = 'Freeze v1 mobile is a read-mostly companion; write operations are disabled';

class SyncService {
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private initializePromise: Promise<void> | null = null;
  private callbacks: Set<SyncCallback> = new Set();
  private pulling = false;
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
    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        await localDb.initDatabase();
        await this.updatePendingCount();
      })().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }
    await this.initializePromise;
  }

  private async ensureReady(): Promise<void> {
    await this.initialize();
  }

  private async updatePendingCount(): Promise<void> {
    try {
      const unsynced = await localDb.getUnsyncedEntities();
      this.updateStatus({ pending: unsynced.length });
    } catch (error) {
      console.error('Failed to update pending count:', error);
    }
  }

  async sync(): Promise<void> {
    await this.pullFromServer();
  }

  async pullFromServer(): Promise<Entity[]> {
    await this.ensureReady();
    if (!api.isConfigured()) {
      return [];
    }

    // 防止并发 pull（自动同步 60s 一次，上一次可能未完成）
    if (this.pulling) {
      return [];
    }
    this.pulling = true;

    try {
      // 并行获取实体和关系，直接使用 /api/relationships 端点获取完整 Relationship（含时间字段）
      // 移动端有意只镜像最近 1000 个实体（性能保护：完整 1万+ 图谱常驻桌面端，
      // 手机灌入本地库再渲染不划算）。需要全量请用桌面端。
      const [entitiesResult, relationshipsResult] = await Promise.all([
        api.getEntities({ limit: 1000 }),
        api.getRelationships(2000),
      ]);

      if (!entitiesResult.success || !entitiesResult.data) {
        this.updateStatus({ error: entitiesResult.error ?? '获取服务器数据失败' });
        return [];
      }

      const serverEntities = entitiesResult.data;
      const serverRelationships: Relationship[] =
        relationshipsResult.success && relationshipsResult.data ? relationshipsResult.data : [];

      await localDb.syncFromServer(serverEntities, serverRelationships);

      await this.updatePendingCount();
      return serverEntities;
    } catch (error) {
      console.error('Failed to pull from server:', error);
      this.updateStatus({ error: (error as Error).message });
      return [];
    } finally {
      this.pulling = false;
    }
  }

  async fullSync(): Promise<void> {
    // Freeze v1 mobile is a read-mostly companion. Do not upload queued local
    // writes until stable IDs, tombstones, idempotency and conflict resolution
    // are implemented end-to-end.
    await this.pullFromServer();
  }

  startAutoSync(intervalMs: number = 60000): void {
    this.stopAutoSync();
    this.syncInterval = setInterval(() => {
      this.fullSync();
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

  async addEntity(entity: Entity): Promise<void> {
    void entity;
    throw new Error(READ_ONLY_ERROR);
  }

  async updateEntity(id: string, updates: Partial<Entity>): Promise<void> {
    void id;
    void updates;
    throw new Error(READ_ONLY_ERROR);
  }

  async deleteEntity(id: string): Promise<void> {
    void id;
    throw new Error(READ_ONLY_ERROR);
  }

  async getEntities(limit?: number, offset?: number): Promise<Entity[]> {
    await this.ensureReady();
    return localDb.getEntities(limit, offset);
  }

  async searchEntities(query: string): Promise<Entity[]> {
    await this.ensureReady();
    return localDb.searchEntitiesLocal(query);
  }
}

export const syncService = new SyncService();
