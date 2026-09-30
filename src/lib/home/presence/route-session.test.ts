import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/apns', () => ({
  isApnsConfigured: () => false,
  sendLiveActivity: vi.fn(),
  isDeadToken: () => false,
  isDeviceToken: () => true,
}));

const {
  cardMode,
  hashShareToken,
  isShareToken,
  newShareToken,
  readFixes,
  readRouteLine,
  routeContent,
  routeEndContent,
  routeWorthPushing,
  sweepReason,
  thin,
  ROUTE_MAX_POINTS,
} = await import('./route-session');

const now = new Date('2026-09-30T09:00:00Z');
const reading = (alongM: number, extra: Partial<{ offRoute: boolean; offRouteM: number; timeLeftS: number | null }> = {}) => ({
  alongM,
  remainingM: 10_000 - alongM,
  offRouteM: extra.offRouteM ?? 5,
  offRoute: extra.offRoute ?? false,
  timeLeftS: extra.timeLeftS === undefined ? (10_000 - alongM) / 1.3 : extra.timeLeftS,
});
const base = { name: 'Sam Kelly', routeName: 'Reservoir loop', sport: 'walk', totalM: 10_000, lastFixAt: now, now };

describe('the Lock Screen card for a route', () => {
  it('says how far along, the time left, and uses a first name', () => {
    const c = routeContent({ ...base, reading: reading(6200) });
    expect(c.headline).toBe('Sam · Reservoir loop');
    expect(c.detail).toBe('6.2 of 10 km · ~49 min left');
    expect(c.progress).toBe(0.62);
    expect(c.etaMinutes).toBe(49);
    expect(c.distanceHomeM).toBeNull();
    expect(c.mode).toBe('walking');
  });

  it('says off route, and gives no ETA while off it', () => {
    const c = routeContent({ ...base, reading: reading(3000, { offRoute: true, offRouteM: 180 }) });
    expect(c.detail).toBe('off route · 180 m from the line');
    expect(c.etaMinutes).toBeNull();
  });

  it('says starting before the first reading', () => {
    expect(routeContent({ ...base, reading: null, lastFixAt: null }).detail).toBe('10 km route · starting');
  });

  it('says last seen when the phone has gone quiet', () => {
    const c = routeContent({ ...base, reading: reading(4000), lastFixAt: new Date(now.getTime() - 15 * 60_000) });
    expect(c.detail).toContain('last seen');
  });

  it('ends as ENDED, never ARRIVED — the arrived card says "Home"', () => {
    const last = routeContent({ ...base, reading: reading(9900) });
    const done = routeEndContent({ ...base, last }, 'finished', now, now);
    expect(done.phase).toBe('ended');
    expect(done.progress).toBe(1);
    expect(done.detail).toMatch(/^finished at /);
  });

  it('a run shows as on the move', () => {
    expect(cardMode('run')).toBe('active');
    expect(cardMode('hike')).toBe('walking');
  });
});

describe('when a push is worth sending', () => {
  const at = (m: number, extra = {}) => routeContent({ ...base, reading: reading(m, extra) });

  it('not for 30 m more', () => {
    expect(routeWorthPushing(at(1200), at(1230), 10_000)).toBe(false);
  });

  it('for the next 100 m under 2 km, and the next 250 m above', () => {
    expect(routeWorthPushing(at(1200), at(1320), 10_000)).toBe(true);
    expect(routeWorthPushing(at(5000), at(5100), 10_000)).toBe(false);
    expect(routeWorthPushing(at(5000, { timeLeftS: 3850 }), at(5300, { timeLeftS: 3850 }), 10_000)).toBe(true);
  });

  it('always for leaving or rejoining the route', () => {
    expect(routeWorthPushing(at(3000), at(3000, { offRoute: true, offRouteM: 90 }), 10_000)).toBe(true);
  });
});

describe('ending by itself', () => {
  const started = new Date(now.getTime() - 60 * 60_000);
  it('keeps a session with a recent fix', () => {
    expect(sweepReason({ startedAt: started, lastFixAt: new Date(now.getTime() - 60_000) }, now)).toBeNull();
  });
  it('ends one quiet for half an hour, or never heard from', () => {
    expect(sweepReason({ startedAt: started, lastFixAt: new Date(now.getTime() - 31 * 60_000) }, now)).toBe('stale');
    expect(sweepReason({ startedAt: started, lastFixAt: null }, now)).toBe('stale');
  });
  it('ends one at six hours however it is going', () => {
    expect(sweepReason({ startedAt: new Date(now.getTime() - 6.1 * 3600_000), lastFixAt: now }, now)).toBe('timeout');
  });
});

describe('what the phone sends', () => {
  it('thins a long route and keeps its ends', () => {
    const line = Array.from({ length: 2000 }, (_, i) => [40.78 + i * 1e-5, -73.96]);
    const out = readRouteLine(line)!;
    expect(out).toHaveLength(ROUTE_MAX_POINTS);
    expect(out[out.length - 1][0]).toBeCloseTo(40.78 + 1999e-5, 5);
  });

  it('refuses a route with no line', () => {
    expect(readRouteLine([[40.78, -73.96]])).toBeNull();
    expect(readRouteLine('x')).toBeNull();
  });

  it('keeps fixes in time order and drops ones from the future or off the map', () => {
    const t = now.getTime() / 1000;
    const { fixes, reading: r } = readFixes(
      {
        fixes: [
          { lat: 40.781, lng: -73.96, t: t - 10 },
          { lat: 40.78, lng: -73.96, t: t - 20 },
          { lat: 40.78, lng: -73.96, t: t + 3600 },
          { lat: 95, lng: 0, t },
        ],
        progress: { alongM: 100, remainingM: 9900, offRouteM: 4, offRoute: false, timeLeftS: 7000 },
      },
      now,
    );
    expect(fixes.map((f) => f.t)).toEqual([t - 20, t - 10]);
    expect(r?.alongM).toBe(100);
  });
});

describe('share links', () => {
  it('are 256 bits, url-safe, and stored as a hash', () => {
    const token = newShareToken();
    expect(isShareToken(token)).toBe(true);
    expect(hashShareToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(isShareToken('short')).toBe(false);
    expect(isShareToken(`${token}/..`)).toBe(false);
  });
});

describe('thin', () => {
  it('leaves a short list alone', () => {
    expect(thin([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
});
