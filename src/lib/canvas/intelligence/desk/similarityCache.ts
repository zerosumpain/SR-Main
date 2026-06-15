// src/lib/canvas/intelligence/desk/similarityCache.ts
//
// Client-side wrapper around GET /api/deepdive/[id]/clusters?by=similarity.
// The server clusters facts.embedding with greedy cosine and is itself cached
// per (sessionId, factCount); on the client we additionally cache the resolved
// factId->clusterId Map keyed on the fact-count we asked for, and dedupe
// concurrent calls, so switching to/from the 'similarity' dimension never
// re-hits the network for an unchanged fact set.

export interface SimilarityClusterRow {
  factId: string;
  clusterId: string;
  clusterLabel: string;
}

export interface SimilarityCache {
  /** Resolve factId->clusterId for the given fact-count. Cached per count;
   *  a failed fetch resolves to an empty map and is NOT cached (retried). */
  get(factCount: number): Promise<Map<string, string>>;
}

export function createSimilarityCache(
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): SimilarityCache {
  // Resolved maps keyed by fact-count.
  const resolved = new Map<number, Map<string, string>>();
  // In-flight promises keyed by fact-count (concurrent-call dedupe).
  const inflight = new Map<number, Promise<Map<string, string>>>();

  async function fetchFor(factCount: number): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const res = await fetchImpl(
        `/api/deepdive/${sessionId}/clusters?by=similarity`,
      );
      if (!res.ok) return map; // empty, not cached (see get())
      const body = (await res.json()) as { clusters?: SimilarityClusterRow[] };
      for (const row of body.clusters ?? []) {
        map.set(String(row.factId), String(row.clusterId));
      }
      resolved.set(factCount, map); // cache only on success
      return map;
    } catch {
      return map;
    }
  }

  return {
    get(factCount: number): Promise<Map<string, string>> {
      const hit = resolved.get(factCount);
      if (hit) return Promise.resolve(hit);
      const pending = inflight.get(factCount);
      if (pending) return pending;
      const p = fetchFor(factCount).finally(() => inflight.delete(factCount));
      inflight.set(factCount, p);
      return p;
    },
  };
}
