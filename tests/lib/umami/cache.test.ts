import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTTLCache } from '$lib/umami/cache';

describe('TTL cache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns cached value within TTL', async () => {
    const cache = createTTLCache<string, number>({ ttlMs: 1_000 });
    let calls = 0;
    const loader = async () => { calls++; return 42; };
    expect(await cache.getOrLoad('k', loader)).toBe(42);
    expect(await cache.getOrLoad('k', loader)).toBe(42);
    expect(calls).toBe(1);
  });

  it('refreshes after TTL', async () => {
    const cache = createTTLCache<string, number>({ ttlMs: 100 });
    let n = 0;
    await cache.getOrLoad('k', async () => ++n);
    vi.advanceTimersByTime(200);
    const result = await cache.getOrLoad('k', async () => ++n);
    expect(result).toBe(2);
  });
});
