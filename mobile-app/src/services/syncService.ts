import { api } from './api';
import * as localDb from './localDb';
import { Entity, Relationship, SyncStatus } from '@/types';

type SyncCallback = (status: SyncStatus) => void;
const SYNC_UPLOAD_CONCURRENCY = 5;

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
    await this.ensureReady();
    if (this.status.syncing) {
      return;
    }

    if (!api.isConfigured()) {
      this.updateStatus({ error: 'API not configured' });
      return;
    }

    this.updateStatus({ syncing: true, error: null });

    try {
      const unsynced = await localDb.getUnsyncedEntities();

      if (unsynced.length === 0) {
        this.updateStatus({
          syncing: false,
          lastSync: Date.now(),
          pending: 0,
        });
        return;
      }

      // 服务端当前没有批量写入接口；用有限并发降低等待时间，同时只标记真正成功的记录。
      let successCount = 0;
      let lastError: string | null = null;
      let cursor = 0;

      const uploadOne = async (entity: Entity) => {
        const res = await api.addEntity(entity);
        if (res.success && res.data) {
          // 服务器会生成新 ID，用返回的实体替换本地记录，避免 ID 不一致导致重复
          const serverEntity = res.data;
          if (serverEntity.id !== entity.id) {
            await localDb.deleteEntity(entity.id);
            await localDb.addEntity(serverEntity, true);
          } else {
            await localDb.markEntitySynced(entity.id);
          }
          successCount++;
        } else {
          lastError = res.error ?? 'Sync failed';
        }
      };

      const workerCount = Math.min(SYNC_UPLOAD_CONCURRENCY, unsynced.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < unsynced.length) {
          const index = cursor++;
          if (index >= unsynced.length) break;
          await uploadOne(unsynced[index]);
        }
      });

      await Promise.all(workers);

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
    await this.ensureReady();
    await localDb.addEntity(entity);
    await this.updatePendingCount();

    if (api.isConfigured() && entity.synced === false) {
      // sync() 内部已捕获错误并写入 status.error；
      // 这里仍包一层 catch，防止 unhandled rejection 出现在 RN 红屏
      this.sync().catch((err) => {
        console.warn('Background sync failed:', err);
        this.updateStatus({ error: (err as Error).message });
      });
    }
  }

  async updateEntity(id: string, updates: Partial<Entity>): Promise<void> {
    await this.ensureReady();
    await localDb.updateEntity(id, updates);
    await this.updatePendingCount();
    
    if (api.isConfigured()) {
      this.sync().catch((err) => {
        console.warn('Background sync on update failed:', err);
        this.updateStatus({ error: (err as Error).message });
      });
    }
  }

  async deleteEntity(id: string): Promise<void> {
    await this.ensureReady();

    // 先删远程，成功后再删本地，避免远程失败导致数据不一致
    if (api.isConfigured()) {
      const res = await api.deleteEntity(id);
      if (!res.success) {
        throw new Error(res.error ?? '删除远程实体失败');
      }
    }

    await localDb.deleteEntity(id);
    await this.updatePendingCount();
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
