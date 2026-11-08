import { describe, expect, it } from 'vitest';
import { whatChanged } from './changes';
import { datesBetween } from './forecast-eval';
import type { PresenceInsights, RouteInsight } from './insights';

const weekdays = (from: string, to: string) => datesBetween(from, to).filter((d) => ![0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()));
// 14 Sep – 23 Oct 2026, BST: 07:20Z is 08:20 local. The line is 14 days before 25 Oct.
const earlier = weekdays('2026-09-14', '2026-10-09');
const recent = weekdays('2026-10-12', '2026-10-23');
const now = new Date('2026-10-25T18:00:00Z');

function route(over: Partial<RouteInsight> & { trips: RouteInsight['trips'] }): RouteInsight {
  return {
    id: 'alex:home:school:vehicle', subject: 'alex', person: 'Alex', fromId: 'home', toId: 'school', from: 'Home', to: 'School',
    samples: over.trips.length, average: 15, median: 15, low: 14, high: 16, departure: '08:20', morning: 0, mode: 'vehicle', broken: 0,
    ...over,
  };
}
const trips = (dates: string[], at: string, minutes: number | ((i: number) => number)) =>
  dates.map((d, i) => ({ start: `${d}T${at}:00Z`, minutes: typeof minutes === 'number' ? minutes : minutes(i), broken: false }));
// A September of odd trips, so Alex has a history before the four weeks a "new" routine looks at.
const september = route({ id: 'alex:home:shop:active', toId: 'shop', to: 'Shop', mode: 'active', trips: trips(['2026-09-02', '2026-09-09', '2026-09-17'], '11:00', 9) });
const insights = (routes: RouteInsight[]): PresenceInsights => ({
  generatedAt: now.toISOString(), days: 56, people: [{ subject: 'alex', displayName: 'Alex' } as PresenceInsights['people'][number]],
  routes: [...routes, september], arrivals: [], live: [], groups: [], together: 0, daily: [],
});

describe('what changed', () => {
  it('sees the school run leaving later, and says by how much', () => {
    const r = route({ trips: [...trips(earlier, '07:20', 15), ...trips(recent, '07:35', 15)] });
    const [c] = whatChanged(insights([r]), now);
    expect(c).toMatchObject({ kind: 'later', subject: 'alex' });
    expect(c.title).toBe('Alex leaves for School 15 min later');
    expect(c.detail).toContain('08:35');
  });

  it('sees a journey getting slower, but not one that always varied that much', () => {
    const slower = route({ trips: [...trips(earlier, '07:20', (i) => 14 + (i % 3)), ...trips(recent, '07:20', (i) => 21 + (i % 2))] });
    expect(whatChanged(insights([slower]), now).map((c) => c.kind)).toEqual(['slower']);
    const wander = route({ trips: [...trips(earlier, '07:20', (i) => [10, 40, 25, 60, 15][i % 5]), ...trips(recent, '07:20', (i) => 30 + (i % 3))] });
    expect(whatChanged(insights([wander]), now).filter((c) => c.kind === 'slower' || c.kind === 'quicker')).toHaveLength(0);
  });

  it('never compares across a change of tracker', () => {
    const r = route({ trips: [...trips(earlier, '07:20', 15), ...trips(recent, '07:20', 21)] });
    expect(whatChanged(insights([r]), now).map((c) => c.kind)).toEqual(['slower']);
    const switched = new Map([['alex', Date.parse('2026-10-12T00:00:00Z')]]);
    expect(whatChanged(insights([r]), now, undefined, switched)).toEqual([]);
  });

  it('names a routine that has started', () => {
    // Tuesdays from 6 Oct: three runs inside four weeks, none before.
    const swim = route({ id: 'alex:home:pool:active', toId: 'pool', to: 'Pool', mode: 'active', trips: trips(['2026-10-06', '2026-10-13', '2026-10-20'], '15:00', 10) });
    const school = route({ trips: trips([...earlier, ...recent], '07:20', 15) });
    const titles = whatChanged(insights([school, swim]), now).map((c) => `${c.kind}:${c.title}`);
    expect(titles).toEqual(['new-routine:New: Alex to Pool on Tuesdays']);
  });

  it('names a routine that has stopped, but not over a school holiday', () => {
    const club = route({ id: 'alex:school:club:active', fromId: 'school', toId: 'club', from: 'School', to: 'Club', mode: 'active', trips: trips(earlier, '15:00', 10) });
    expect(whatChanged(insights([club]), now).map((c) => c.kind)).toEqual(['faded']);
    const cal = { holidays: [{ from: '2026-10-12', to: '2026-10-23' }], schoolIds: new Set(['school']) };
    expect(whatChanged(insights([club]), now, cal)).toEqual([]);
  });

  it('notices someone driving more', () => {
    const walk = route({ id: 'alex:home:school:active', mode: 'active', trips: trips(earlier, '07:20', 15) });
    const drive = route({ trips: trips(recent, '07:20', 8) });
    expect(whatChanged(insights([walk, drive]), now).some((c) => c.kind === 'less-active' && c.title === 'Alex is driving more')).toBe(true);
  });

  it('calls nothing new for someone only just tracked', () => {
    const fresh = { ...insights([route({ trips: trips(recent, '07:20', 15) })]) };
    fresh.routes = fresh.routes.filter((r) => r !== september);
    expect(whatChanged(fresh, now)).toEqual([]);
  });

  it('is silent on thin evidence', () => {
    const r = route({ trips: [...trips(earlier.slice(0, 2), '07:20', 15), ...trips(recent.slice(0, 2), '07:50', 30)] });
    expect(whatChanged(insights([r]), now)).toEqual([]);
  });
});
