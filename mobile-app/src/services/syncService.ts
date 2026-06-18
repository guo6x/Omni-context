import { api } from './api';
import * as localDb from './localDb';
import { Entity, SyncStatus } from '@/types';

type SyncCallback = (status: SyncStatus) => void;
const SYNC_UPLOAD_CONCURRENCY = 5;

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
      const unsynced = await localDb.getUnsyncedEntities();
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
        if (res.success) {
          await localDb.markEntitySynced(entity.id);
          successCount++;
        } else {
          lastError = res.error ?? 'Sync failed';
        }
      };

      const workerCount = Math.min(SYNC_UPLOAD_CONCURRENCY, unsynced.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
          const index = cursor++;
          if (index >= unsynced.length) return;
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
    if (!api.isConfigured()) {
      return [];
    }

    try {
      // 并行获取实体和关系
      // 移动端有意只镜像最近 1000 个实体（性能保护：完整 1万+ 图谱常驻桌面端，
      // 手机灌入本地库再渲染不划算）。需要全量请用桌面端。
      const [entitiesResult, relationshipsResult] = await Promise.all([
        api.getEntities({ limit: 1000 }),
        // 获取关系 - 我们先获取知识图谱来获取关系
        api.getKnowledgeGraph()
      ]);

      if (!entitiesResult.success || !entitiesResult.data) {
        this.updateStatus({ error: entitiesResult.error ?? '获取服务器数据失败' });
        return [];
      }

      const serverEntities = entitiesResult.data;
      const serverRelationships = relationshipsResult.success && relationshipsResult.data
        ? relationshipsResult.data.edges.map(edge => ({
            id: edge.id,
            source_id: edge.source,
            target_id: edge.target,
            type: edge.type,
            description: edge.description,
            weight: edge.weight,
            created_at: new Date().toISOString(),
            last_activated: new Date().toISOString(),
            valid_from: undefined,
            valid_until: undefined,
            invalidated_at: undefined,
            invalidation_reason: undefined,
          }))
        : [];

      await localDb.syncFromServer(serverEntities, serverRelationships);
      
      await this.updatePendingCount();
      return serverEntities;
    } catch (error) {
      console.error('Failed to pull from server:', error);
      this.updateStatus({ error: (error as Error).message });
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
    await localDb.addEntity(entity);
    await this.updatePendingCount();

    if (api.isConfigured() && (entity as any).synced === false) {
      // sync() 内部已捕获错误并写入 status.error；
      // 这里仍包一层 catch，防止 unhandled rejection 出现在 RN 红屏
      this.sync().catch((err) => {
        console.warn('Background sync failed:', err);
        this.updateStatus({ error: (err as Error).message });
      });
    }
  }

  async updateEntity(id: string, updates: Partial<Entity>): Promise<void> {
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
    await localDb.deleteEntity(id);
    await this.updatePendingCount();
    
    if (api.isConfigured()) {
      await api.deleteEntity(id);
    }
  }

  async getEntities(limit?: number, offset?: number): Promise<Entity[]> {
    return localDb.getEntities(limit, offset);
  }

  async searchEntities(query: string): Promise<Entity[]> {
    return localDb.searchEntitiesLocal(query);
  }
}

export const syncService = new SyncService();
