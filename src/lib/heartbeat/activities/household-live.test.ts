import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  written: 0,
  views: 0,
  viewsFail: false,
  membersFail: false,
}));

vi.mock('$lib/home/presence/members', () => ({
  listMembers: async () => {
    if (h.membersFail) throw new Error('db hiccup');
    return [];
  },
}));
vi.mock('$lib/home/presence/companion', () => ({
  ingestCompanion: async () => ({ pages: 1, written: h.written, dropped: 0, rejected: 0, skipped: 0, thinned: 3, more: false }),
}));
vi.mock('$lib/home/presence/app-view', () => ({
  pushAppViews: async () => {
    h.views++;
    if (h.viewsFail) return { stored: 0, refused: 0, error: 'views answered 502' };
    return { stored: 2, refused: 0 };
  },
}));

const { householdLive, resetHouseholdLive, VIEW_REFRESH_S } = await import('./household-live');
const ctx = { config: {} } as unknown as Parameters<typeof householdLive.run>[0];

beforeEach(() => {
  h.written = 0;
  h.views = 0;
  h.viewsFail = false;
  h.membersFail = false;
  resetHouseholdLive();
  vi.useRealTimers();
});

describe('household-live', () => {
  it('runs on the engine tick', () => {
    expect(householdLive.defaultCadenceSeconds).toBe(30);
  });

  it('rebuilds the views when app fixes arrived', async () => {
    h.written = 4;
    const first = await householdLive.run(ctx);
    const second = await householdLive.run(ctx);
    expect(h.views).toBe(2);
    expect(second.summary).toContain('companion: 4 written, 3 thinned');
    expect(first.summary).toContain('app views: 2 stored');
  });

  it('skips the rebuild on a quiet tick, until the refresh interval has passed', async () => {
    vi.useFakeTimers();
    await householdLive.run(ctx); // first run always pushes
    await householdLive.run(ctx);
    expect(h.views).toBe(1);
    vi.advanceTimersByTime(VIEW_REFRESH_S * 1000);
    await householdLive.run(ctx);
    expect(h.views).toBe(2);
  });

  it('retries a failed push on the next tick rather than waiting two minutes', async () => {
    h.viewsFail = true;
    const res = await householdLive.run(ctx);
    expect(res.outcome).toBe('ok');
    expect(res.summary).toContain('failed: views answered 502');
    h.viewsFail = false;
    await householdLive.run(ctx);
    expect(h.views).toBe(2);
  });

  it('never fails the run when members cannot be read', async () => {
    h.membersFail = true;
    const res = await householdLive.run(ctx);
    expect(res.outcome).toBe('ok');
    expect(h.views).toBe(0);
  });
});
