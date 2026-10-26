import Dexie, { type Table } from 'dexie';

export type SyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'ARCHIVED';

export interface StoredOrder<TPayload = unknown> {
  id?: number;
  projectId: string;
  actorId?: string;
  boothId?: string | null;
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
    super(import.meta.env?.MODE === 'localdb' ? 'booth-pos-local-dev-db' : 'booth-pos-offline-db');

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
    // Index-only upgrade: old payloads, local IDs and uncertain queue rows stay intact.
    this.version(4).stores({
      orders: '++id, projectId, actorId, [projectId+syncStatus], [projectId+localOrderId], [actorId+projectId], localOrderId, createdAt, syncStatus, retryCount, lastSyncAt',
      posState: 'key, projectId, updatedAt',
    });
    // Additive upgrade: existing sales, payloads and uncertain commands survive.
    this.version(5).stores({
      resources: 'key, actorId, scopeKey, updatedAt',
      resourceCommands: '++sequence, &id, actorId, scopeKey, resourceKey, status',
    });
  }
}

export const db = new PosDatabase();
