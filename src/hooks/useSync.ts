import { useCallback, useEffect, useState } from 'react';
import { syncService, type SyncSnapshot } from '../sync/syncService';
import { isOnline, subscribeNetwork } from '../sync/network';

interface UseSyncOptions {
  enabled: boolean;
  getAuthToken: () => string | null;
  projectId?: string | null;
}

export interface UseSyncResult extends SyncSnapshot {
  online: boolean;
  syncNow: () => Promise<void>;
  refreshPendingCount: () => Promise<void>;
}

export function useSync({ enabled, getAuthToken, projectId }: UseSyncOptions): UseSyncResult {
  const [online, setOnline] = useState(isOnline());
  const [snapshot, setSnapshot] = useState<SyncSnapshot>({ isSyncing: false, pendingCount: 0, lastSyncedAt: null });

  useEffect(() => {
    syncService.configure({ getAuthToken, projectId });
  }, [getAuthToken, projectId]);

  useEffect(() => syncService.subscribe(setSnapshot), []);

  const syncNow = useCallback(async () => {
    if (!enabled) return;
    await syncService.sync();
  }, [enabled]);

  const refreshPendingCount = useCallback(async () => {
    await syncService.refreshPendingCount();
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;

    void syncService.sync();
    const timer = window.setInterval(() => void syncService.sync(), 10_000);
    const unsubscribe = subscribeNetwork((nextOnline) => {
      setOnline(nextOnline);
      if (nextOnline) void syncService.sync();
    });

    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [enabled]);

  return { ...snapshot, online, syncNow, refreshPendingCount };
}