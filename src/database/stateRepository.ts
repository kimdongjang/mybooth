import { db } from './dexie';

export interface PosStateCache {
  dataRevision?: string | null;
  products: unknown[];
  bundles: unknown[];
  sales: unknown[];
}

const stateKey = (projectId: string) => `project:${projectId}:latest`;

export const stateRepository = {
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
