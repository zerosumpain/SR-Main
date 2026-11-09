import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  written: 0,
  views: 0,
  viewsFail: false,
  membersFail: false,
  alertsFail: false,
  calls: [] as string[],
}));

vi.mock('$lib/home/presence/alerts', () => ({
  runCrossings: async () => {
    h.calls.push('crossings');
    if (h.alertsFail) throw new Error('events table missing');
    return { written: 1, deduped: 0, initialised: [], errors: [] };
  },
  deliverAlerts: async () => {
    h.calls.push('deliver');
    if (h.alertsFail) throw new Error('pilot down');
    return { pushed: 2, forwarded: 1, unfollowed: 0, whatsappSent: ['…000'], whatsappFailed: [] };
  },
}));
vi.mock('$lib/home/presence/live-journey', () => ({
  runLiveJourneys: async () => {
    h.calls.push('journeys');
    return { started: 0, updated: 0, ended: 0, errors: [] };
  },
}));
vi.mock('$lib/home/presence/battery-alerts.server', () => ({
  deliverBatteryAlerts: async () => {
    h.calls.push('battery');
    return { sent: 1, errors: [] };
  },
}));
vi.mock('$lib/home/presence/stops.server', () => ({ discoverRecentStops: async () => ({}) }));
vi.mock('$lib/home/presence/eta-alerts.server', () => ({ deliverArrivalEstimates: async () => ({ sent: 0 }) }));
vi.mock('$lib/people/erase', () => ({ sweepAccountDeletions: async () => ({ deleted: 0, failed: 0 }) }));

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
  h.alertsFail = false;
  h.calls = [];
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

  it('raises crossings straight after the pull, delivers them, moves journeys, then low battery', async () => {
    h.written = 2;
    const res = await householdLive.run(ctx);
    expect(h.calls).toEqual(['crossings', 'deliver', 'journeys', 'battery']);
    expect(res.summary).toContain('crossings: 1 new');
    expect(res.summary).toContain('alerts: 2 pushed, 1 to the app, WhatsApp to …000');
    expect(res.summary).toContain('low battery: 1 told');
  });

  it('never fails the run when crossings or delivery throw', async () => {
    h.alertsFail = true;
    const res = await householdLive.run(ctx);
    expect(res.outcome).toBe('ok');
    expect(res.summary).toContain('crossings failed');
    expect(res.summary).toContain('alerts failed');
    expect(h.views).toBe(1);
  });
});
