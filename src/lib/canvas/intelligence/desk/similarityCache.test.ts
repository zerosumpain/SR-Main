import { describe, it, expect, vi } from 'vitest';
import { createSimilarityCache } from './similarityCache';

function fakeFetch(payload: unknown, status = 200) {
  return vi.fn(async (_input: RequestInfo | URL) =>
    ({ ok: status < 400, status, json: async () => payload }) as unknown as Response,
  );
}

describe('createSimilarityCache', () => {
  it('fetches once and maps factId -> clusterLabel (for meaningful group labels)', async () => {
    // The map stores clusterLabel as the value (not clusterId) so that
    // groupBySimilarity can surface meaningful topic labels in the pile headers.
    // All members of the same cluster share the same clusterLabel, so they
    // still group together; the label string doubles as the stable group key.
    const fetchImpl = fakeFetch({
      clusters: [
        { factId: 'f1', clusterId: 'c0', clusterLabel: 'Topic about economics' },
        { factId: 'f2', clusterId: 'c0', clusterLabel: 'Topic about economics' },
        { factId: 'f3', clusterId: 'c1', clusterLabel: 'Topic about education' },
      ],
    });
    const cache = createSimilarityCache('sess1', fetchImpl as unknown as typeof fetch);
    const map = await cache.get(3);
    expect(map.get('f1')).toBe('Topic about economics');
    expect(map.get('f2')).toBe('Topic about economics'); // same cluster → same label
    expect(map.get('f3')).toBe('Topic about education');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/deepdive/sess1/clusters?by=similarity');
  });

  it('caches by fact-count: same count → no refetch, new count → refetch', async () => {
    const fetchImpl = fakeFetch({ clusters: [{ factId: 'f1', clusterId: 'c0', clusterLabel: 'A' }] });
    const cache = createSimilarityCache('sess1', fetchImpl as unknown as typeof fetch);
    await cache.get(5);
    await cache.get(5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await cache.get(6);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent calls for the same count into one request', async () => {
    const fetchImpl = fakeFetch({ clusters: [] });
    const cache = createSimilarityCache('sess1', fetchImpl as unknown as typeof fetch);
    const [a, b] = await Promise.all([cache.get(4), cache.get(4)]);
    expect(a).toBe(b); // same resolved Map instance
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns an empty map and does not cache on a failed fetch', async () => {
    const fetchImpl = fakeFetch({}, 500);
    const cache = createSimilarityCache('sess1', fetchImpl as unknown as typeof fetch);
    const map = await cache.get(2);
    expect(map.size).toBe(0);
    await cache.get(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // a failure is retried next time
  });
});
