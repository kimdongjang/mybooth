import { useCallback, useEffect, useRef, useState } from 'react';
import { syncService, type SyncSnapshot } from '../sync/syncService';
import { isOnline, subscribeNetwork } from '../sync/network';
import { createBackgroundSync, SYNC_INTERVAL_MS } from '../sync/backgroundSync';

interface UseSyncOptions {
  enabled: boolean;
  getAuthToken: () => string | null;
  projectId?: string | null;
  actorId?: string | null;
  boothId?: string | null;
  refreshEnabled?: boolean;
  onRefresh?: () => Promise<boolean | void>;
}

export interface UseSyncResult extends SyncSnapshot {
  online: boolean;
  syncNow: () => Promise<void>;
  refreshPendingCount: () => Promise<void>;
}

export function useSync({ enabled, getAuthToken, projectId, actorId, boothId, refreshEnabled = enabled, onRefresh }: UseSyncOptions): UseSyncResult {
  const [online, setOnline] = useState(isOnline());
  const [snapshot, setSnapshot] = useState<SyncSnapshot>({ isSyncing: false, pendingCount: 0, lastSyncedAt: null });
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const cycle = useRef<ReturnType<typeof createBackgroundSync> | null>(null);

  useEffect(() => {
    syncService.configure({ getAuthToken, projectId: enabled ? projectId : null, actorId, boothId });
  }, [enabled, getAuthToken, projectId, actorId, boothId]);

  useEffect(() => syncService.subscribe(setSnapshot), []);

  const syncNow = useCallback(async () => {
    await cycle.current?.({force:true});
  }, []);

  const refreshPendingCount = useCallback(async () => {
    await syncService.refreshPendingCount();
  }, []);

  useEffect(() => {
    if (!refreshEnabled) return undefined;
    let active = true;
    const run = createBackgroundSync({
      upload: () => enabled ? syncService.sync() : Promise.resolve(null),
      refresh: () => refresh.current?.(),
      online: isOnline,
      isCurrent: () => active,
    });
    cycle.current = run;
    const timer = window.setInterval(() => { if (!document.hidden) void run(); }, SYNC_INTERVAL_MS);
    const resume = () => { if (!document.hidden) void run({force:true}); };
    document.addEventListener('visibilitychange', resume);
    const unsubscribe = subscribeNetwork((nextOnline) => {
      setOnline(nextOnline);
      if (nextOnline) void run({force:true});
    });

    return () => {
      window.clearInterval(timer);
      active = false;
      if (cycle.current === run) cycle.current = null;
      document.removeEventListener('visibilitychange', resume);
      unsubscribe();
    };
  }, [enabled, refreshEnabled, projectId, actorId, boothId, getAuthToken]);

  return { ...snapshot, online, syncNow, refreshPendingCount };
}
