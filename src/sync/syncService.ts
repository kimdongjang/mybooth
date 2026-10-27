import { orderRepository, type OrderRepository } from '../database/orderRepository';
import { isOnline } from './network';

export interface SyncSnapshot {
  isSyncing: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
  lastError?: string | null;
}

export type SyncListener = (snapshot: SyncSnapshot) => void;

interface SyncServiceOptions {
  repository?: OrderRepository;
  endpoint?: string;
  getAuthToken?: () => string | null;
  projectId?: string | null;
  actorId?: string | null;
  boothId?: string | null;
}

class SyncService {
  private repository: OrderRepository;
  private endpoint: string;
  private getAuthToken: () => string | null;
  private projectId: string | null;
  private actorId: string | null = null;
  private boothId: string | null = null;
  private locked = false;
  private listeners = new Set<SyncListener>();
  private snapshot: SyncSnapshot = { isSyncing: false, pendingCount: 0, lastSyncedAt: null };

  constructor(options: SyncServiceOptions = {}) {
    this.repository = options.repository || orderRepository;
    this.endpoint = options.endpoint || '/api/pos';
    this.getAuthToken = options.getAuthToken || (() => null);
    this.projectId = options.projectId || null;
  }

  configure(options: Pick<SyncServiceOptions, 'getAuthToken' | 'projectId' | 'actorId' | 'boothId'>): void {
    if (options.getAuthToken) this.getAuthToken = options.getAuthToken;
    if (this.projectId !== (options.projectId || null) || this.actorId !== (options.actorId || null) || this.boothId !== (options.boothId || null)) {
      this.snapshot = { ...this.snapshot, lastSyncedAt: null };
      this.emit();
    }
    this.projectId = options.projectId || null;
    this.actorId = options.actorId || null;
    this.boothId = options.boothId || null;
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
    // Browser locks are released on tab termination, allowing safe recovery.
    if (typeof navigator === 'undefined' || !navigator.locks) {
      this.snapshot = { ...this.snapshot, lastError: '안전한 동기화를 위해 Web Locks를 지원하는 HTTPS 브라우저가 필요합니다.' };
      await this.refreshPendingCount();
      return this.snapshot;
    }
    return navigator.locks.request('pos-order-upload', { ifAvailable: true }, async lock => {
      if (!lock) return this.snapshot;
      return this.syncLocked();
    });
  }

  private async syncLocked(): Promise<SyncSnapshot> {
    if (this.locked) return this.snapshot;
    if (!isOnline()) {
      await this.refreshPendingCount();
      return this.snapshot;
    }

    this.locked = true;
    this.snapshot = { ...this.snapshot, isSyncing: true, lastError: null };
    this.emit();

    try {
      if (!this.projectId) return this.snapshot;
      const projectId = this.projectId;
      const actorId = this.actorId;
      const boothId = this.boothId;
      const token = this.getAuthToken();
      const orders = await this.repository.getPendingOrders(projectId);
      for (const order of orders) {
        if (this.projectId !== projectId || this.actorId!==actorId || this.boothId!==boothId || this.getAuthToken() !== token) break;
        if (!order.id || order.projectId !== projectId || (order.payload as { projectId?: string })?.projectId !== projectId) continue;
        if(order.actorId && (order.actorId!==actorId || (order.boothId && order.boothId!==boothId))) {
          this.snapshot={...this.snapshot,lastError:'원래 주문 계정과 부스에서 동기화해주세요.'};
          this.emit();break;
        }
        await this.repository.updateStatus(order.id, 'SYNCING');
        await this.refreshPendingCount();

        try {

          const response = await fetch(this.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(order.payload),
            signal: AbortSignal.timeout(20_000),
          });
          // A truncated success response is uncertain, so retain and retry the ID.
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || '주문 동기화에 실패했습니다.');

          const syncedAt = new Date().toISOString();
          await this.repository.updateStatus(order.id, 'SYNCED', { lastSyncAt: syncedAt });
          if (this.projectId === projectId && this.actorId===actorId && this.boothId===boothId && this.getAuthToken() === token) {
            this.snapshot = { ...this.snapshot, lastSyncedAt: syncedAt };
          }
        } catch (error) {
          this.snapshot = { ...this.snapshot, lastError: error instanceof Error ? error.message : '동기화에 실패했습니다.' };
          await this.repository.updateStatus(order.id, 'FAILED', { retryCount: (order.retryCount || 0) + 1 });
          console.warn('[sync] order sync failed', order.localOrderId, error);
          break; // Preserve sale-before-cancellation dependencies.
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
