import { orderRepository, type OrderRepository } from '../database/orderRepository';
import { isOnline } from './network';

export interface SyncSnapshot {
  isSyncing: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
}

export type SyncListener = (snapshot: SyncSnapshot) => void;

interface SyncServiceOptions {
  repository?: OrderRepository;
  endpoint?: string;
  getAuthToken?: () => string | null;
  projectId?: string | null;
}

class SyncService {
  private repository: OrderRepository;
  private endpoint: string;
  private getAuthToken: () => string | null;
  private projectId: string | null;
  private locked = false;
  private listeners = new Set<SyncListener>();
  private snapshot: SyncSnapshot = { isSyncing: false, pendingCount: 0, lastSyncedAt: null };

  constructor(options: SyncServiceOptions = {}) {
    this.repository = options.repository || orderRepository;
    this.endpoint = options.endpoint || '/api/pos';
    this.getAuthToken = options.getAuthToken || (() => null);
    this.projectId = options.projectId || null;
  }

  configure(options: Pick<SyncServiceOptions, 'getAuthToken' | 'projectId'>): void {
    if (options.getAuthToken) this.getAuthToken = options.getAuthToken;
    this.projectId = options.projectId || null;
    void this.refreshPendingCount();
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    void this.refreshPendingCount();
    return () => this.listeners.delete(listener);
  }

  async refreshPendingCount(): Promise<void> {
    this.snapshot = { ...this.snapshot, pendingCount: this.projectId ? await this.repository.countWaiting(this.projectId) : 0 };
    this.emit();
  }

  async sync(): Promise<SyncSnapshot> {
    if (this.locked) return this.snapshot;
    if (!isOnline()) {
      await this.refreshPendingCount();
      return this.snapshot;
    }

    this.locked = true;
    this.snapshot = { ...this.snapshot, isSyncing: true };
    this.emit();

    try {
      if (!this.projectId) return this.snapshot;
      const orders = await this.repository.getPendingOrders(this.projectId);
      for (const order of orders) {
        if (!order.id) continue;
        await this.repository.updateStatus(order.id, 'SYNCING');
        await this.refreshPendingCount();

        try {
          const token = this.getAuthToken();
          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(order.payload),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || '주문 동기화에 실패했습니다.');

          const syncedAt = new Date().toISOString();
          await this.repository.updateStatus(order.id, 'SYNCED', { lastSyncAt: syncedAt });
          this.snapshot = { ...this.snapshot, lastSyncedAt: syncedAt };
        } catch (error) {
          await this.repository.updateStatus(order.id, 'FAILED', { retryCount: (order.retryCount || 0) + 1 });
          console.warn('[sync] order sync failed', order.localOrderId, error);
        }
      }
    } finally {
      this.locked = false;
      this.snapshot = { ...this.snapshot, isSyncing: false, pendingCount: this.projectId ? await this.repository.countWaiting(this.projectId) : 0 };
      this.emit();
    }

    return this.snapshot;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

export const syncService = new SyncService();