import { describe, expect, it } from 'vitest';
import { buildMoveHistory, HISTORY_TRIPS_MAX } from './move-history';
import type { PersonInsight, PresenceInsights, RouteInsight } from './insights';

// Weekdays of 7–25 Sep 2026 (BST). 07:20Z is 08:20 local.
const WEEKDAYS = ['07', '08', '09', '10', '11', '14', '15', '16', '17', '18', '21', '22', '23', '24', '25'].map((d) => `2026-09-${d}`);
const now = new Date('2026-09-28T06:00:00Z');

function route(over: Partial<RouteInsight> & { starts: string[]; minutes?: number[] }): RouteInsight {
  const minutes = over.minutes ?? over.starts.map(() => 15);
  return {
    id: 'alex:home:school:vehicle', subject: 'alex', person: 'Alex', fromId: 'home', toId: 'school', from: 'Home', to: 'School',
    samples: over.starts.length, average: 17, median: 17, low: 15, high: 19, departure: '08:20', morning: 0,
    mode: 'vehicle', broken: 0,
    trips: over.starts.map((s, i) => ({ start: s, minutes: minutes[i], broken: false })),
    ...over,
  };
}

const person = (subject: string, displayName: string) => ({ subject, displayName }) as PersonInsight;

function insights(routes: RouteInsight[], people = [person('alex', 'Alex'), person('sam', 'Sam')]): PresenceInsights {
  return { generatedAt: now.toISOString(), days: 28, people, routes, arrivals: [], live: [], groups: [], together: 0, daily: [] };
}

// Ten school runs: 08:20, 08:22 … with two late (08:45) and one early (08:00).
const clocks = ['07:20', '07:22', '07:18', '07:20', '07:45', '07:21', '07:00', '07:19', '07:45', '07:20'];
const school = route({
  starts: WEEKDAYS.slice(0, 10).map((d, i) => `${d}T${clocks[i]}:00Z`),
  minutes: [20, 20, 20, 20, 20, 14, 14, 14, 14, 14],
});
const back = route({
  id: 'alex:school:home:vehicle', fromId: 'school', toId: 'home', from: 'School', to: 'Home', departure: '15:30',
  starts: WEEKDAYS.slice(0, 4).map((d) => `${d}T14:30:00Z`),
});
const sams = route({ id: 'sam:home:gym:active', subject: 'sam', person: 'Sam', to: 'Gym', starts: [`${WEEKDAYS[0]}T17:00:00Z`] });

describe('move history', () => {
  const h = buildMoveHistory(insights([school, back, sams]), 'alex', now)!;

  it('is the one person only, named, with the window', () => {
    expect(h).toMatchObject({ subject: 'alex', name: 'Alex', days: 28, generatedAt: now.toISOString() });
    expect(h.trips.every((t) => t.to !== 'Gym')).toBe(true);
    expect(JSON.stringify(h)).not.toMatch(/"lat"|"lon"|@/);
  });

  it('totals trips, places, clean minutes and a weekly rate', () => {
    expect(h.totals).toEqual({ trips: 14, places: 2, minutes: 5 * 20 + 5 * 14 + 4 * 15, perWeek: 3.5 });
  });

  it('ranks destinations by arrivals with their share', () => {
    expect(h.places).toEqual([{ name: 'School', trips: 10, share: 0.71 }, { name: 'Home', trips: 4, share: 0.29 }]);
  });

  it('ranks routes by trips and compares the newer half with the older', () => {
    expect(h.routes.map((r) => r.id)).toEqual(['alex:home:school:vehicle', 'alex:school:home:vehicle']);
    expect(h.routes[0]).toMatchObject({ trips: 10, earlierMedian: 20, recentMedian: 14, departure: '08:20', lastAt: `${WEEKDAYS[9]}T07:20:00Z` });
    // Four clean trips is enough; fewer says nothing.
    expect(h.routes[1]).toMatchObject({ earlierMedian: 15, recentMedian: 15 });
    const thin = buildMoveHistory(insights([route({ starts: WEEKDAYS.slice(0, 3).map((d) => `${d}T07:20:00Z`) })]), 'alex', now)!;
    expect(thin.routes[0]).toMatchObject({ recentMedian: null, earlierMedian: null });
  });

  it('says how each routine keeps time', () => {
    const run = h.routines.find((r) => r.id === 'alex:home:school:vehicle:weekday')!;
    expect(run).toMatchObject({ departure: '08:20', dayType: 'weekday', punctuality: { early: 1, onTime: 7, late: 2 } });
  });

  it('lists trips newest first, capped, and counts departures by weekday and hour', () => {
    expect(h.trips[0]).toMatchObject({ from: 'Home', to: 'School', start: `${WEEKDAYS[9]}T07:20:00Z`, mode: 'vehicle' });
    expect(h.pattern).toHaveLength(7);
    expect(h.pattern[0]).toHaveLength(24);
    // 7 and 14 Sep 2026 are Mondays: school both at 08:2x local, home at 15:30 on the 7th only.
    expect(h.pattern[0][8]).toBe(2);
    expect(h.pattern[0][15]).toBe(1);
    expect(h.pattern.flat().reduce((a, b) => a + b, 0)).toBe(14);
    const many = route({ starts: Array.from({ length: 200 }, (_, i) => new Date(+now - (i + 1) * 3_600_000).toISOString()) });
    expect(buildMoveHistory(insights([many]), 'alex', now)!.trips).toHaveLength(HISTORY_TRIPS_MAX);
  });

  it('is null for somebody not in the insights', () => {
    expect(buildMoveHistory(insights([school]), 'rory', now)).toBeNull();
  });
});
