import React from 'react';
import type { UseSyncResult } from '../hooks/useSync';

interface SyncStatusProps {
  sync: UseSyncResult;
}

export function SyncStatus({ sync }: SyncStatusProps) {
  const statusText = sync.online ? '온라인' : '오프라인';
  const queueText = sync.isSyncing ? '동기화 중…' : sync.pendingCount > 0 ? `동기화 대기 ${sync.pendingCount}건` : '동기화 완료';

  return (
    <button
      type="button"
      className="sync-status"
      disabled={sync.isSyncing || !sync.online}
      onClick={sync.syncNow}
      aria-label={`${statusText}, ${queueText}. 지금 동기화`}
      title="지금 동기화"
      aria-busy={sync.isSyncing}
    >
      <span className="sync-copy" aria-live="polite">
        <span className="sync-connection"><span className={`sync-dot ${sync.online ? 'is-online' : ''}`} aria-hidden="true" />{statusText}</span>
        <span className="sync-queue">{queueText}</span>
      </span>
      <svg className={`sync-icon ${sync.isSyncing ? 'is-syncing' : ''}`} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></svg>
    </button>
  );
}
