import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The forecast's 28-day trail scan is read once per trail change, not per poll.

const h = vi.hoisted(() => ({ scans: 0, rows: [] as Array<{ subject: string; ts: Date }>, analysed: [] as number[] }));

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    execute: async () => {
      h.scans++;
      return { rows: h.rows.map((r) => ({ ...r, ts: r.ts.toISOString() })) };
    },
  },
}));
vi.mock('./members', () => ({
  listMembers: async () => [{ subject: 'alex', displayName: 'Alex', source: 'life360', email: null, haPersonEntity: null, whatsapp: null, alerts: {} }],
}));
vi.mock('./companion', () => ({ loadCompanionUsers: async () => [], notSharingSubjects: () => new Set() }));
vi.mock('./insights', () => ({
  analysePresence: (rows: unknown[]) => {
    h.analysed.push(rows.length);
    return { people: [], rows: rows.length };
  },
}));

const { loadPresenceInsights, resetInsightsCacheForTest } = await import('./insights.server');
const { trailChanged } = await import('./trail-generation');

const T0 = new Date('2026-10-22T09:00:00Z');
const at = (ms: number) => new Date(+T0 + ms);
const load = (now: Date, days = 28) => loadPresenceInsights({ kind: 'owner' }, days, null, now);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  resetInsightsCacheForTest();
  h.scans = 0;
  h.analysed.length = 0;
  h.rows = [{ subject: 'alex', ts: at(-60_000) }];
});
afterEach(() => vi.useRealTimers());

describe('loadPresenceInsights trail rows', () => {
  it('reuses the scan past the 20-second answer while nothing is written', async () => {
    await load(T0);
    vi.setSystemTime(at(30_000));
    await load(at(30_000));
    expect(h.scans).toBe(1);
    expect(h.analysed).toEqual([1, 1]);
  });

  it('scans again after a trail write, after two minutes, and for an earlier now', async () => {
    await load(T0);
    trailChanged();
    await load(T0);
    expect(h.scans).toBe(2);
    vi.setSystemTime(at(121_000));
    await load(at(121_000));
    expect(h.scans).toBe(3);
    vi.setSystemTime(at(150_000));
    await load(at(100_000));
    expect(h.scans).toBe(4);
  });

  it('drops reused rows the later window no longer covers', async () => {
    h.rows = [{ subject: 'alex', ts: at(-28 * 86_400_000 + 10_000) }, { subject: 'alex', ts: at(-60_000) }];
    await load(T0);
    vi.setSystemTime(at(30_000));
    await load(at(30_000));
    expect(h.scans).toBe(1);
    expect(h.analysed).toEqual([2, 1]);
  });

  it('never keeps the 90-day window', async () => {
    await load(T0, 90);
    vi.setSystemTime(at(30_000));
    await load(at(30_000), 90);
    expect(h.scans).toBe(2);
  });
});
