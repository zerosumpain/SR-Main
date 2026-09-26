import { describe, expect, it, vi } from 'vitest';

// Made-up coordinates throughout (51.0, -1.0): this repo is public.
const LAT = 51.0;
const LON = -1.0;
const northOf = (metres: number) => LAT + metres / 111_320;

// A chainable stand-in for drizzle's builder: every call returns the chain,
// and awaiting it yields the rows for whichever query was built — told apart
// by the columns selected.
const trailRows: Array<Record<string, unknown>> = [];
let labelRows: Array<Record<string, unknown>> = [{ id: 'p-home', label: 'Home', status: 'active' }];
function chain(fields: Record<string, unknown>) {
  const rows = 'ts' in fields ? trailRows : 'label' in fields ? labelRows : [{ id: 'p-home' }];
  const c: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit']) c[m] = () => c;
  c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
  return c;
}
vi.mock('$lib/db', () => ({ db: { select: (fields: Record<string, unknown>) => chain(fields) } }));

const { activeLabels, railJourney, visitsFromFixes, loadMovementStats, placeTimeByPerson } = await import('./movement');

describe('railJourney', () => {
  it('accepts a fast, straight run of fixes and refuses a slow or a turning one', () => {
    const straight = [0, 1, 2, 3].map((i) => ({ lat: northOf(i * 2000), lon: LON, speedKmh: 110 }));
    expect(railJourney(straight)).toBe(true);
    expect(railJourney(straight.map((f) => ({ ...f, speedKmh: 40 })))).toBe(false);
    const zigzag = straight.map((f, i) => ({ ...f, lon: LON + (i % 2 ? 0.03 : 0) }));
    expect(railJourney(zigzag)).toBe(false);
  });
});

describe('visitsFromFixes', () => {
  it('turns a run of still fixes at one place into one labelled stay', () => {
    const t0 = Date.parse('2026-10-20T08:00:00Z');
    const fixes = Array.from({ length: 10 }, (_, i) => ({
      ts: new Date(t0 + i * 2 * 60_000),
      lat: LAT,
      lon: LON,
      subject: 'alex',
      placeId: 'p-home',
    }));
    const visits = visitsFromFixes(fixes, new Map([['p-home', 'Home']]));
    expect(visits).toEqual([
      { placeId: 'p-home', label: 'Home', from: fixes[0].ts, to: fixes[9].ts },
    ]);
  });
});

describe('loadMovementStats', () => {
  it('returns stats with no coordinate in them', async () => {
    const now = new Date('2026-10-28T12:00:00Z');
    const t0 = Date.parse('2026-10-27T08:00:00Z');
    trailRows.length = 0;
    // Half an hour at home, then a 3 km walk north.
    for (let i = 0; i < 15; i++) {
      trailRows.push({ ts: new Date(t0 + i * 120_000), lat: LAT, lon: LON, speedKmh: 0, mode: 'still', placeId: 'p-home' });
    }
    for (let i = 1; i <= 15; i++) {
      trailRows.push({
        ts: new Date(t0 + (14 + i) * 120_000),
        lat: northOf(i * 200),
        lon: LON,
        speedKmh: 6,
        mode: 'walking',
        placeId: null,
      });
    }
    const stats = await loadMovementStats('alex', { days: 30, now });
    expect(stats.byMode.foot.count).toBe(1);
    expect(stats.timeOut).toHaveLength(30);
    expect(JSON.stringify(stats)).not.toMatch(/"(lat|lon)"|51\.0|-1\.0/);
  });
});

describe('place names for the stats', () => {
  it('lends a name only from an active place: a removed one reads as unnamed', () => {
    const m = activeLabels([
      { id: 'a', label: 'School', status: 'active' },
      { id: 'b', label: 'Carmel College', status: 'ignored' },
      { id: 'c', label: 'Old', status: 'merged' },
    ]);
    expect([...m.entries()]).toEqual([
      ['a', 'School'],
      ['b', null],
      ['c', null],
    ]);
  });
});

describe('placeTimeByPerson', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  const t0 = Date.parse('2026-10-27T08:00:00Z');
  /** An hour standing still at a place. */
  function hourAt(subject: string, placeId: string, startMs: number) {
    for (let i = 0; i <= 30; i++) {
      trailRows.push({ ts: new Date(startMs + i * 120_000), subject, lat: LAT, lon: LON, placeId });
    }
  }

  it('breaks each place down by person, and skips a removed place', async () => {
    trailRows.length = 0;
    hourAt('alex', 'p-school', t0);
    hourAt('alex', 'p-gone', t0 + 3 * 3_600_000);
    hourAt('sam', 'p-home', t0 + 6 * 3_600_000);
    labelRows = [
      { id: 'p-school', label: 'School', status: 'active' },
      { id: 'p-gone', label: 'Carmel College', status: 'ignored' },
      { id: 'p-home', label: null, status: 'active' },
    ];
    const out = await placeTimeByPerson(
      [
        { subject: 'alex', displayName: 'Alex' },
        { subject: 'sam', displayName: 'Sam' },
      ],
      { days: 30, now },
    );
    expect(out['p-school']).toMatchObject([{ subject: 'alex', minutes: 60, visits: 1 }]);
    expect(out['p-gone']).toBeUndefined();
    // Home, unnamed, is still home.
    expect(out['p-home']).toMatchObject([{ subject: 'sam', minutes: 60 }]);
    expect(JSON.stringify(out)).not.toMatch(/"(lat|lon)"|51\.0|-1\.0/);
    labelRows = [{ id: 'p-home', label: 'Home', status: 'active' }];
  });

  it('reads nothing for nobody', async () => {
    expect(await placeTimeByPerson([], { now })).toEqual({});
  });
});
