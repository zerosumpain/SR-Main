export function createTTLCache<K, V>(opts: { ttlMs: number }) {
  const store = new Map<K, { value: V; expiresAt: number }>();
  return {
    async getOrLoad(key: K, loader: () => Promise<V>): Promise<V> {
      const now = Date.now();
      const hit = store.get(key);
      if (hit && hit.expiresAt > now) return hit.value;
      const value = await loader();
      store.set(key, { value, expiresAt: now + opts.ttlMs });
      return value;
    },
    clear(): void { store.clear(); },
  };
}
