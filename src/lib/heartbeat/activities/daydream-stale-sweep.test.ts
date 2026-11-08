import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSetting = vi.fn();
const sweepStale = vi.fn();
vi.mock('$lib/server/models/settings', () => ({ getSetting: (...a: unknown[]) => getSetting(...a) }));
vi.mock('$lib/daydream/think/notes.server', () => ({ sweepStale: (...a: unknown[]) => sweepStale(...a) }));
vi.mock('$lib/daydream/types', () => ({
  SETTINGS_ENABLED_KEY: 'daydream.enabled',
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { daydreamStaleSweep } from './daydream-stale-sweep';

const ctx = { now: Date.parse('2026-10-20T08:00:00Z'), config: {}, action: {} } as never;

describe('daydream-stale-sweep', () => {
  beforeEach(() => {
    getSetting.mockReset();
    sweepStale.mockReset();
  });

  it('does nothing while daydreaming is off', async () => {
    getSetting.mockResolvedValue(false);
    expect(await daydreamStaleSweep.run(ctx)).toEqual({ outcome: 'skipped', summary: 'daydreaming disabled' });
    expect(sweepStale).not.toHaveBeenCalled();
  });

  it('reports what it filed', async () => {
    getSetting.mockResolvedValue(true);
    sweepStale.mockResolvedValue({ filed: 2, flagged: 5, titles: ['a', 'b'] });
    const r = await daydreamStaleSweep.run(ctx);
    expect(r.outcome).toBe('ok');
    expect(r.summary).toBe('filed 2 of 5 flagged');
    expect(sweepStale.mock.calls[0][0]).toEqual(new Date('2026-10-20T08:00:00Z'));
  });

  it('skips quietly when nothing is due, and reports a failure', async () => {
    getSetting.mockResolvedValue(null);
    sweepStale.mockResolvedValueOnce({ filed: 0, flagged: 3, titles: [] });
    expect((await daydreamStaleSweep.run(ctx)).summary).toBe('nothing due (3 flagged)');
    sweepStale.mockRejectedValueOnce(new Error('db down'));
    expect(await daydreamStaleSweep.run(ctx)).toEqual({ outcome: 'error', summary: 'failed: db down' });
  });
});
