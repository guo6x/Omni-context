import { useState, useEffect, useCallback } from 'react';
import { syncService } from '@/services/syncService';
import { SyncStatus } from '@/types';

export function useSync() {
  const [status, setStatus] = useState<SyncStatus>(syncService.getStatus());

  useEffect(() => {
    const unsubscribe = syncService.subscribe(setStatus);
    return unsubscribe;
  }, []);

  const sync = useCallback(async () => {
    await syncService.sync();
  }, []);

  const fullSync = useCallback(async () => {
    await syncService.fullSync();
  }, []);

  const startAutoSync = useCallback((intervalMs?: number) => {
    syncService.startAutoSync(intervalMs);
  }, []);

  const stopAutoSync = useCallback(() => {
    syncService.stopAutoSync();
  }, []);

  return {
    status,
    sync,
    fullSync,
    startAutoSync,
    stopAutoSync,
    isSyncing: status.syncing,
    pendingCount: status.pending,
    lastSync: status.lastSync,
    error: status.error,
  };
}
