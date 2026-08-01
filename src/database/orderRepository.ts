import { db, type StoredOrder, type SyncStatus } from './dexie';

export interface OrderRepository {
  add(order: Omit<StoredOrder, 'id'>): Promise<number>;
  getAll(projectId: string): Promise<StoredOrder[]>;
  getPendingOrders(projectId: string): Promise<StoredOrder[]>;
  countWaiting(projectId: string): Promise<number>;
  updateStatus(id: number, syncStatus: SyncStatus, patch?: Partial<StoredOrder>): Promise<void>;
  deletePendingByLocalOrderId(projectId: string, localOrderId: string): Promise<number>;
}

export class DexieOrderRepository implements OrderRepository {
  async add(order: Omit<StoredOrder, 'id'>): Promise<number> {
    return db.orders.add(order);
  }

  async getAll(projectId: string): Promise<StoredOrder[]> {
    return db.orders.where('projectId').equals(projectId).sortBy('createdAt');
  }

  async getPendingOrders(projectId: string): Promise<StoredOrder[]> {
    return db.orders
      .where('[projectId+syncStatus]')
      .anyOf([[projectId, 'PENDING'], [projectId, 'FAILED']])
      .sortBy('createdAt');
  }

  async countWaiting(projectId: string): Promise<number> {
    return db.orders.where('[projectId+syncStatus]').anyOf([[projectId, 'PENDING'], [projectId, 'FAILED'], [projectId, 'SYNCING']]).count();
  }

  async updateStatus(id: number, syncStatus: SyncStatus, patch: Partial<StoredOrder> = {}): Promise<void> {
    await db.orders.update(id, { ...patch, syncStatus });
  }

  async deletePendingByLocalOrderId(projectId: string, localOrderId: string): Promise<number> {
    return db.orders
      .where('[projectId+localOrderId]')
      .equals([projectId, localOrderId])
      .and((order) => order.syncStatus === 'PENDING' || order.syncStatus === 'FAILED')
      .delete();
  }
}

export const orderRepository = new DexieOrderRepository();