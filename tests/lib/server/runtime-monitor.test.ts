import { describe, it, expect, vi, afterEach } from 'vitest';
import { beginBatch, activeBatches, isBusyWithLiveBatch, memoryLine } from '$lib/server/runtime-monitor';

afterEach(() => {
  vi.useRealTimers();
  // Any batch a test leaves open would leak into the next one.
  for (const _ of activeBatches()) {
    /* handles are local to each test; see explicit end() calls below */
  }
});

describe('batch liveness', () => {
  it('reports nothing busy when no batch is registered', () => {
    expect(activeBatches()).toEqual([]);
    expect(isBusyWithLiveBatch()).toBe(false);
  });

  it('a freshly started batch excuses a stall', () => {
    const b = beginBatch('intel:sweep', 'starting');
    expect(isBusyWithLiveBatch()).toBe(true);
    expect(activeBatches()[0]).toMatchObject({ name: 'intel:sweep', phase: 'starting', stale: false });
    b.end();
    expect(isBusyWithLiveBatch()).toBe(false);
  });

  it('tracks the phase so a block can be attributed', () => {
    const b = beginBatch('intel:sweep');
    b.beat('12/400 threads');
    expect(activeBatches()[0].phase).toBe('12/400 threads');
    b.end();
  });

  // The whole point: a job that stops reporting progress is wedged, and must
  // NOT keep the watchdog at bay.
  it('goes stale once beats stop, and stops excusing anything', () => {
    vi.useFakeTimers();
    const b = beginBatch('intel:sweep', 'working');
    vi.advanceTimersByTime(121_000);
    expect(activeBatches()[0].stale).toBe(true);
    expect(isBusyWithLiveBatch()).toBe(false);
    b.end();
  });

  it('a beat resets staleness', () => {
    vi.useFakeTimers();
    const b = beginBatch('intel:sweep', 'working');
    vi.advanceTimersByTime(121_000);
    expect(isBusyWithLiveBatch()).toBe(false);
    b.beat('still going');
    expect(isBusyWithLiveBatch()).toBe(true);
    b.end();
  });

  it('end() is idempotent and beats after it are harmless', () => {
    const b = beginBatch('intel:sweep');
    b.end();
    b.end();
    expect(() => b.beat('after the end')).not.toThrow();
    expect(isBusyWithLiveBatch()).toBe(false);
  });

  it('keeps concurrent batches independent', () => {
    const a = beginBatch('intel:sweep');
    const c = beginBatch('intel:gmail-sweep');
    expect(activeBatches().map((x) => x.name).sort()).toEqual(['intel:gmail-sweep', 'intel:sweep']);
    a.end();
    expect(activeBatches().map((x) => x.name)).toEqual(['intel:gmail-sweep']);
    c.end();
  });
});

describe('memoryLine', () => {
  it('reports each figure in whole megabytes', () => {
    const MB = 1_048_576;
    expect(memoryLine({ rss: 1900 * MB, heapUsed: 300.4 * MB, heapTotal: 360 * MB, external: 40 * MB, arrayBuffers: 12.6 * MB }))
      .toBe('[runtime] memory rss=1900MB heapUsed=300MB heapTotal=360MB external=40MB arrayBuffers=13MB');
  });
});
