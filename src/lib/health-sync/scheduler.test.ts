import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./sync-service', () => ({ syncAll: vi.fn() }));

import { syncAll } from './sync-service';
import { startScheduler, stopScheduler } from './scheduler';

const sync = vi.mocked(syncAll);

describe('Health sync scheduler lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SYNC_INTERVAL_MS = '60000';
    sync.mockReset();
    sync.mockResolvedValue({} as Awaited<ReturnType<typeof syncAll>>);
  });

  afterEach(() => {
    stopScheduler();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.SYNC_INTERVAL_MS;
  });

  it('cancels the delayed first sync when stopped during startup', async () => {
    startScheduler();
    stopScheduler();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sync).not.toHaveBeenCalled();
  });

  it('does not start another sync while the previous call is running', async () => {
    let finish!: (value: Awaited<ReturnType<typeof syncAll>>) => void;
    sync.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    startScheduler();
    await vi.advanceTimersByTimeAsync(150_000);
    expect(sync).toHaveBeenCalledTimes(1);
    finish({} as Awaited<ReturnType<typeof syncAll>>);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('starts only one timer after repeated startup calls', async () => {
    startScheduler();
    startScheduler();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(sync).toHaveBeenCalledTimes(2);
    stopScheduler();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
