import React from 'react';
import type { UseSyncResult } from '../hooks/useSync';

interface SyncStatusProps {
  sync: UseSyncResult;
}

export function SyncStatus({ sync }: SyncStatusProps) {
  const statusText = sync.online ? '🟢 온라인' : '🔴 오프라인';
  const queueText = sync.pendingCount > 0 ? `⬆ 동기화 대기 ${sync.pendingCount}건` : '✔ 동기화 완료';

  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-paper px-2.5 py-1.5 text-[11px] text-slate-600">
      <span>{statusText}</span>
      <span className="text-slate-300">|</span>
      <span>{sync.isSyncing ? '동기화 중...' : queueText}</span>
      <button
        type="button"
        disabled={sync.isSyncing || !sync.online}
        onClick={sync.syncNow}
        className="rounded border border-line bg-paper px-2 py-1 text-[11px] disabled:opacity-50"
      >
        동기화
      </button>
    </div>
  );
}