import { randomUUID } from 'node:crypto';

export type UndoSnapshot = {
  postId: number;
  field: string;
  previousValue: unknown;
};

export type UndoStore = {
  put: (snapshot: UndoSnapshot) => string;
  take: (token: string) => UndoSnapshot | null;
};

export function createUndoStore(opts: { ttlMs: number }): UndoStore {
  const map = new Map<string, { snapshot: UndoSnapshot; expiresAt: number }>();
  return {
    put(snapshot) {
      const token = randomUUID();
      map.set(token, { snapshot, expiresAt: Date.now() + opts.ttlMs });
      return token;
    },
    take(token) {
      const entry = map.get(token);
      if (!entry) return null;
      map.delete(token);
      if (entry.expiresAt < Date.now()) return null;
      return entry.snapshot;
    },
  };
}

export const undoStore: UndoStore = createUndoStore({ ttlMs: 30 * 60 * 1000 });
