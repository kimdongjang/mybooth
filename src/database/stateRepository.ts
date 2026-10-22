import { db, type StoredOrder } from './dexie';

export interface PosStateCache {
  settlementClosedAt?: string | null;
  archivedAt?: string | null;
  dataRevision?: string | null;
  products: unknown[];
  bundles: unknown[];
  sales: unknown[];
}

const stateKey = (projectId: string) => `project:${projectId}:latest`;

export const stateRepository = {
  async setSettlementClosedAt(projectId: string, closedAt: string | null): Promise<void> {
    await db.transaction('rw', db.posState, async () => {const current=await this.get(projectId);if(current)await this.save(projectId,{...current,settlementClosedAt:closedAt});});
  },
  async queueVersion(projectId: string): Promise<string> {
    const orders = await db.orders.where('projectId').equals(projectId).toArray();
    return JSON.stringify(orders.map(order => [order.id, order.syncStatus]));
  },
  async acceptRemote(projectId: string, state: PosStateCache, queueVersion?: string): Promise<PosStateCache> {
    return db.transaction('rw', db.orders, db.posState, async () => {
      const waiting = await db.orders.where('projectId').equals(projectId)
        .and(order => ['PENDING', 'FAILED', 'SYNCING'].includes(order.syncStatus)).count();
      if (waiting || (queueVersion !== undefined && queueVersion !== await this.queueVersion(projectId))) {
        const cached = await this.get(projectId);
        if (!cached) throw new Error('미전송 주문의 로컬 상태가 없습니다. 주문 백업을 보존해주세요.');
        if(state.settlementClosedAt !== undefined){cached.settlementClosedAt=state.settlementClosedAt;await this.save(projectId,cached);}
        return cached;
      }
      await this.save(projectId, state);
      return state;
    });
  },
  // Both stores commit together; a stale tab must reload instead of overwriting sales.
  async commitOrder(projectId: string, order: Omit<StoredOrder, 'id'>, expected: PosStateCache, next: PosStateCache): Promise<void> {
    await db.transaction('rw', db.orders, db.posState, async () => {
      const current = await this.get(projectId);
      if (((current as PosStateCache | null)?.archivedAt || (current as PosStateCache | null)?.settlementClosedAt)) throw new Error('보관되었거나 정산이 마감된 행사에서는 판매·취소할 수 없습니다.');
      for (const key of ['products', 'bundles', 'sales', 'dataRevision'] as const) {
        if (JSON.stringify(current?.[key]) !== JSON.stringify(expected[key])) {
          throw new Error('다른 탭에서 행사 데이터가 변경되었습니다. 새로고침 후 다시 시도해주세요.');
        }
      }
      if (order.projectId !== projectId || (order.payload as { projectId?: string })?.projectId !== projectId) throw new Error('주문 행사 범위가 일치하지 않습니다.');
      await db.orders.add({ ...order });
      await this.save(projectId, next);
    });
  },
  async setArchivedAt(projectId: string, archivedAt: string | null): Promise<void> {
    await db.posState.update(stateKey(projectId), cached => {
      cached.state = { ...(cached.state as PosStateCache), archivedAt };
    });
  },
  async remove(projectId: string): Promise<void> {
    await db.posState.delete(stateKey(projectId));
  },
  async save(projectId: string, state: PosStateCache): Promise<void> {
    await db.posState.put({
      key: stateKey(projectId),
      projectId,
      updatedAt: new Date().toISOString(),
      state,
    });
  },

  async get(projectId: string): Promise<PosStateCache | null> {
    const cached = await db.posState.get(stateKey(projectId));
    return (cached?.state as PosStateCache | undefined) || null;
  },
};
