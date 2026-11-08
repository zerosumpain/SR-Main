import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SolvedPlan } from './model';

// The I/O half of routing with the database and the network stubbed: what
// time a leg's timetable is asked for, and how long a failed lookup is kept.
const h = vi.hoisted(() => ({ stored: null as unknown, rows: [] as unknown[] }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => h.rows }) }),
    insert: () => ({ values: (v: { value: unknown }) => ({ onConflictDoUpdate: async () => void (h.stored = v.value) }) }),
  },
}));
vi.mock('$lib/db/schema', () => ({ appSettings: { key: 'key' } }));
vi.mock('$lib/secrets/registry', () => ({ resolveSecretForUrl: async () => { throw new Error('no secret registered'); } }));

const { attachLegLines, routeFor } = await import('./routing.server');
const { routeCacheKey } = await import('./routing');

const A = { lat: 41.895, lng: 12.4716 };
const B = { lat: 41.9029, lng: 12.4534 };
const asked: URL[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T09:00:00Z'));
  asked.length = 0;
  h.stored = null;
  h.rows = [];
  delete process.env.ORS_API_KEY;
  vi.stubGlobal('fetch', vi.fn(async (u: URL | string) => {
    asked.push(new URL(String(u)));
    return new Response('{}', { status: 503 });
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('attachLegLines', () => {
  it("asks Transitous for a leg at its own day and departure minute", async () => {
    const plan: SolvedPlan = {
      days: [{
        date: '2026-10-29',
        stayId: 's',
        stops: [
          { id: 'a', kind: 'wish', wishId: 'a', title: 'A', location: A, arriveMin: 900, departMin: 980, waitSec: 0, locked: false, bookingId: null, warnings: [] },
          { id: 'b', kind: 'wish', wishId: 'b', title: 'B', location: B, arriveMin: 1010, departMin: 1070, waitSec: 0, locked: false, bookingId: null, warnings: [] },
        ],
        legs: [{ fromStopId: 'a', toStopId: 'b', mode: 'transit', durationSec: 1800, distanceM: 2000, estimated: false, line: null }],
        warnings: [],
      }],
      dropped: [],
      warnings: [],
      score: 0,
    };
    await attachLegLines(plan, null, { startDate: '2026-10-27', timeZone: 'Europe/Rome' });
    const transit = asked.find((u) => u.hostname === 'api.transitous.org');
    // 16:20 in Rome on 29 Oct (CET) — not 10:00 on the first day.
    expect(transit?.searchParams.get('time')).toBe('2026-10-29T15:20:00.000Z');
  });
});

describe('routeFor', () => {
  it('a failed lookup is answered with an estimate and cached as a stand-in (an hour), not a route', async () => {
    const iso = '2026-10-29T15:20:00.000Z';
    const r = await routeFor('t1', 'transit', A, B, iso);
    expect(r.estimated).toBe(true);
    const entry = (h.stored as Record<string, { fallback?: boolean }>)[routeCacheKey('transit', A, B, iso)];
    expect(entry?.fallback).toBe(true);
    // An hour on, it is asked again rather than served from the cache.
    h.rows = [{ value: h.stored }];
    vi.setSystemTime(new Date(Date.now() + 61 * 60_000));
    const before = asked.length;
    await routeFor('t1', 'transit', A, B, iso);
    expect(asked.length).toBe(before + 1);
  });
});
