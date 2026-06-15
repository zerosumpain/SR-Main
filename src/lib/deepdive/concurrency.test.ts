import { describe, it, expect, afterEach } from 'vitest';
import { pLimit, getLlmConcurrencyLimit } from './concurrency';

// ---------------------------------------------------------------------------
// pLimit — pure concurrency primitives
// ---------------------------------------------------------------------------

describe('pLimit', () => {
  it('throws RangeError for non-positive limits', () => {
    expect(() => pLimit(0)).toThrow(RangeError);
    expect(() => pLimit(-1)).toThrow(RangeError);
  });

  it('resolves all tasks and returns correct values', async () => {
    const limit = pLimit(2);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => limit(() => Promise.resolve(n * 10))),
    );
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it('propagates errors without deadlocking', async () => {
    const limit = pLimit(2);
    const boom = new Error('boom');

    const settled = await Promise.allSettled([
      limit(() => Promise.reject(boom)),
      limit(() => Promise.resolve('ok1')),
      limit(() => Promise.resolve('ok2')),
    ]);

    expect(settled[0]).toEqual({ status: 'rejected', reason: boom });
    expect(settled[1]).toEqual({ status: 'fulfilled', value: 'ok1' });
    expect(settled[2]).toEqual({ status: 'fulfilled', value: 'ok2' });
  });

  it('never exceeds max=1 concurrent tasks', async () => {
    const limit = pLimit(1);
    let inflight = 0;
    let peakInflight = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      limit(async () => {
        inflight++;
        peakInflight = Math.max(peakInflight, inflight);
        // Yield to the micro-task queue so the scheduler has a chance to start
        // another task while this one is "in progress".
        await Promise.resolve();
        inflight--;
        return i;
      }),
    );

    await Promise.all(tasks);
    expect(peakInflight).toBe(1);
  });

  it('never exceeds max=2 concurrent tasks with 5 tasks', async () => {
    const limit = pLimit(2);
    let inflight = 0;
    let peakInflight = 0;

    const tasks = Array.from({ length: 5 }, (_, i) =>
      limit(async () => {
        inflight++;
        peakInflight = Math.max(peakInflight, inflight);
        // Multi-step async work: give the scheduler two chances to over-schedule.
        await Promise.resolve();
        await Promise.resolve();
        inflight--;
        return i;
      }),
    );

    await Promise.all(tasks);
    expect(peakInflight).toBeLessThanOrEqual(2);
    // Also verify all completed
    expect(peakInflight).toBeGreaterThanOrEqual(1);
  });

  it('runs up to max=3 simultaneously with 3 tasks', async () => {
    const limit = pLimit(3);
    let inflight = 0;
    let peakInflight = 0;

    const tasks = Array.from({ length: 3 }, (_, i) =>
      limit(async () => {
        inflight++;
        peakInflight = Math.max(peakInflight, inflight);
        await Promise.resolve();
        inflight--;
        return i;
      }),
    );

    await Promise.all(tasks);
    // With 3 slots and 3 tasks, all should start immediately
    expect(peakInflight).toBe(3);
  });

  it('handles a single task correctly', async () => {
    const limit = pLimit(5);
    const result = await limit(() => Promise.resolve('single'));
    expect(result).toBe('single');
  });

  it('continues processing queued tasks after an error', async () => {
    const limit = pLimit(1);
    const order: number[] = [];

    const settled = await Promise.allSettled([
      limit(async () => {
        await Promise.resolve();
        throw new Error('fail');
      }),
      limit(async () => {
        order.push(2);
        return 'second';
      }),
      limit(async () => {
        order.push(3);
        return 'third';
      }),
    ]);

    expect(settled[0].status).toBe('rejected');
    expect(settled[1]).toEqual({ status: 'fulfilled', value: 'second' });
    expect(settled[2]).toEqual({ status: 'fulfilled', value: 'third' });
    expect(order).toEqual([2, 3]);
  });
});

// ---------------------------------------------------------------------------
// getLlmConcurrencyLimit — reads process.env
// ---------------------------------------------------------------------------

describe('getLlmConcurrencyLimit', () => {
  afterEach(() => {
    delete process.env.DEEPDIVE_LLM_CONCURRENCY;
  });

  it('returns 3 when env var is absent', () => {
    expect(getLlmConcurrencyLimit()).toBe(3);
  });

  it('returns the parsed integer from the env var', () => {
    process.env.DEEPDIVE_LLM_CONCURRENCY = '5';
    expect(getLlmConcurrencyLimit()).toBe(5);
  });

  it('falls back to 3 for non-numeric env var values', () => {
    process.env.DEEPDIVE_LLM_CONCURRENCY = 'banana';
    expect(getLlmConcurrencyLimit()).toBe(3);
  });

  it('falls back to 3 for zero', () => {
    process.env.DEEPDIVE_LLM_CONCURRENCY = '0';
    expect(getLlmConcurrencyLimit()).toBe(3);
  });

  it('falls back to 3 for negative numbers', () => {
    process.env.DEEPDIVE_LLM_CONCURRENCY = '-2';
    expect(getLlmConcurrencyLimit()).toBe(3);
  });

  it('returns 1 (serialise everything)', () => {
    process.env.DEEPDIVE_LLM_CONCURRENCY = '1';
    expect(getLlmConcurrencyLimit()).toBe(1);
  });
});
