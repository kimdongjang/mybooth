import Dexie, { type Table } from 'dexie';

export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'ARCHIVED';

export interface StoredOrder<TPayload = unknown> {
  id?: number;
  projectId: string;
  localOrderId: string;
  createdAt: string;
  payload: TPayload;
  syncStatus: SyncStatus;
  retryCount: number;
  lastSyncAt?: string | null;
}

export interface StoredPosState<TState = unknown> {
  key: string;
  projectId: string;
  updatedAt: string;
  state: TState;
}

export class PosDatabase extends Dexie {
  orders!: Table<StoredOrder, number>;
  posState!: Table<StoredPosState, string>;

  constructor() {
    super('booth-pos-offline-db');

    this.version(1).stores({
      orders: '++id, localOrderId, createdAt, syncStatus, retryCount, lastSyncAt',
    });

    this.version(2).stores({
      orders: '++id, localOrderId, createdAt, syncStatus, retryCount, lastSyncAt',
      posState: 'key, updatedAt',
    });

    this.version(3).stores({
      orders: '++id, projectId, [projectId+syncStatus], [projectId+localOrderId], localOrderId, createdAt, syncStatus, retryCount, lastSyncAt',
      posState: 'key, projectId, updatedAt',
    });
  }
}

export const db = new PosDatabase();
