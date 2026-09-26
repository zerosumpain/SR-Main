import { beforeEach, describe, expect, it, vi } from 'vitest';

const getFromExtracted = vi.hoisted(() => vi.fn());
const postToExtracted = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/extracted-app', () => ({ getFromExtracted, postToExtracted }));

import { getWhoopStatus, queryWhoop, syncWhoop } from '$lib/server/health-service';

describe('Health service boundary', () => {
  beforeEach(() => {
    getFromExtracted.mockReset();
    postToExtracted.mockReset();
  });

  it('reads grant status through the scoped Health lane', async () => {
    getFromExtracted.mockResolvedValue({ connected: true, valid: true });
    await expect(getWhoopStatus()).resolves.toEqual({ connected: true, valid: true });
    expect(getFromExtracted).toHaveBeenCalledWith('health', '/api/health/whoop/status', { timeoutMs: 10_000 });
  });

  it('routes incremental sync to Health and rejects an absent result', async () => {
    const result = { success: true, recordsSynced: 3, errors: [], duration: 42 };
    postToExtracted.mockResolvedValueOnce({ whoop: result }).mockResolvedValueOnce({});
    await expect(syncWhoop()).resolves.toEqual(result);
    expect(postToExtracted).toHaveBeenCalledWith('health', '/api/health/sync',
      { fullBackfill: false }, { timeoutMs: 300_000 });
    await expect(syncWhoop()).rejects.toThrow('Health returned no WHOOP sync result');
  });

  it('queries live records in Health and validates its response', async () => {
    postToExtracted.mockResolvedValueOnce({ rows: [{ id: 1 }] }).mockResolvedValueOnce({});
    await expect(queryWhoop('get_cycles', { limit: 5 })).resolves.toEqual([{ id: 1 }]);
    expect(postToExtracted).toHaveBeenCalledWith('health', '/api/health/whoop/query',
      { operation: 'get_cycles', limit: 5 }, { timeoutMs: 60_000 });
    await expect(queryWhoop('get_cycles', { limit: 5 })).rejects.toThrow('Health returned no WHOOP rows');
  });
});
