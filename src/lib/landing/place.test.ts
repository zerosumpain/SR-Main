import { describe, expect, it } from 'vitest';
import { binOf, cloud, contrast, footpath, lampFor, ridge, skyAt, starfield, sunAltitude, town, TOWN_DAYS } from './place';
import { shipDays } from './rhythm';

const at = (iso: string) => Date.parse(iso);

describe('the sky', () => {
  it('puts the sun where it is over the north of England', () => {
    // 9 Oct: the sun peaks a little under 30° around 13:00 BST and sets about 18:25 BST.
    expect(sunAltitude(at('2026-10-09T13:00:00+01:00'))).toBeGreaterThan(25);
    expect(sunAltitude(at('2026-10-09T13:00:00+01:00'))).toBeLessThan(31);
    expect(Math.abs(sunAltitude(at('2026-10-09T18:25:00+01:00')))).toBeLessThan(1.5);
    expect(sunAltitude(at('2026-10-09T23:40:00+01:00'))).toBeLessThan(-30);
    // Midsummer noon is high; midwinter noon is low.
    expect(sunAltitude(at('2026-06-21T13:10:00+01:00'))).toBeGreaterThan(57);
    expect(sunAltitude(at('2026-12-21T12:10:00Z'))).toBeLessThan(13);
  });

  it('names the light, and tells dawn from dusk', () => {
    expect(skyAt(-40, false).word).toBe('night');
    expect(skyAt(-6, false).word).toBe('dusk');
    expect(skyAt(-6, true).word).toBe('dawn');
    expect(skyAt(2, false).word).toBe('sunset');
    expect(skyAt(2, true).word).toBe('sunrise');
    expect(skyAt(25, false).word).toBe('daylight');
  });

  it('shows stars only once the sun is well down', () => {
    expect(skyAt(10, false).stars).toBe(0);
    expect(skyAt(-2, false).stars).toBe(0);
    expect(skyAt(-9, false).stars).toBeGreaterThan(0);
    expect(skyAt(-30, false).stars).toBe(1);
  });

  it('stays dark enough for every text colour on it, at every hour', () => {
    const cream: [number, number, number] = [237, 228, 212];
    for (let alt = -40; alt <= 60; alt += 0.5) {
      const s = skyAt(alt, false);
      for (const bg of [s.top, s.mid, s.low]) {
        // Unit and caption text is cream at 72%; the kickers are the two on-dark accents.
        expect(contrast([...cream, 0.72], bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast([232, 134, 58], bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast([127, 184, 192], bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('scatters the same stars on the server and in the browser', () => {
    expect(starfield()).toEqual(starfield());
    expect(starfield().every(([x, y]) => x >= 0 && x <= 1000 && y >= 0 && y <= 190)).toBe(true);
  });
});

/** Every day from `from` to `to` with a count from `f`. */
function record(from: string, to: string, f: (i: number) => number) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), i = 0; t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000, i++)
    out.push({ date: new Date(t).toISOString().slice(0, 10), count: f(i) });
  return out;
}

describe('the ridge', () => {
  const cadence = record('2026-03-20', '2026-10-08', (i) => (i * 7) % 11);

  it('runs from the first release to the day before the town, so no day is drawn twice', () => {
    const r = ridge(cadence, '2026-10-09')!;
    const town = shipDays(cadence, '2026-10-09');
    expect(r.from).toBe('2026-03-20');
    expect(r.to).toBe('2026-08-30');
    expect(town[0].date).toBe('2026-08-31');
    expect(r.days + TOWN_DAYS).toBe(204);
  });

  it('draws the same path every time, inside its box', () => {
    const a = ridge(cadence, '2026-10-09')!;
    expect(ridge(cadence, '2026-10-09')).toEqual(a);
    const ys = [...a.d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(a.d.startsWith('M0,100')).toBe(true);
    expect(a.d.endsWith('Z')).toBe(true);
    // The far range never dips in front of the near one.
    const far = [...a.far.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(far.every((v, i) => v <= ys[i] + 0.01)).toBe(true);
  });

  it('pins its label on the highest crest in its right-hand third', () => {
    const r = ridge(record('2026-03-01', '2026-10-09', (i) => (i === 150 ? 40 : 1)), '2026-10-09')!;
    expect(r.pin.x).toBeGreaterThan(0.66);
    expect(r.pin.y).toBeGreaterThan(0.3);
  });

  it('is left out only when the town holds the whole record', () => {
    expect(ridge([], '2026-10-09')).toBeNull();
    // 39 days to today: all of it in the town.
    expect(ridge(record('2026-09-01', '2026-10-09', () => 2), '2026-10-09')).toBeNull();
    expect(ridge(record('2026-08-31', '2026-10-09', () => 2), '2026-10-09')).toBeNull();
  });

  it('draws every day before the town, even in a record of 41 to 46 days', () => {
    for (let extra = 1; extra <= 6; extra++) {
      const from = new Date(Date.parse('2026-08-31T00:00:00Z') - extra * 86_400_000).toISOString().slice(0, 10);
      // The early days busy, the rest one a day, as a young record runs.
      const cadence = record(from, '2026-10-08', (i) => (i < extra ? 9 : 1));
      const r = ridge(cadence, '2026-10-09')!;
      expect(r).not.toBeNull();
      expect(r.days).toBe(extra);
      expect(r.from).toBe(from);
      expect(r.to).toBe('2026-08-30');
      expect(r.d).toMatch(/Z$/);
      expect(r.pin.x).toBeGreaterThan(0);
      expect(r.pin.x).toBeLessThanOrEqual(1);
    }
  });
});

describe('the town', () => {
  const days = shipDays([{ date: '2026-10-07', count: 3 }, { date: '2026-10-08', count: 2 }], '2026-10-09');

  it('lights a window per deploy and leaves the rest dark', () => {
    const t = town(days);
    expect(`${t.lit}${t.lit2}`.match(/M/g)).toHaveLength(5);
    expect(t.perFloor).toBe(1);
    expect(t.blocks).toHaveLength(8);
  });

  it('outlines today even when nothing has shipped', () => {
    const t = town(days);
    expect(t.today.x).toBeGreaterThan(950);
    expect(t.lit).not.toBe('');
  });

  it('stands each block as tall as its busiest day, two storeys at least', () => {
    const t = town(days);
    const last = t.blocks.at(-1)!;
    const quiet = t.blocks[0];
    expect(last.top).toBeLessThan(quiet.top);
    expect(quiet.top).toBeLessThan(100);
    expect(t.blocks.every((b) => b.top >= 0)).toBe(true);
  });

  it('puts two windows to a storey rather than clip a very busy day', () => {
    const t = town(shipDays([{ date: '2026-10-09', count: 20 }], '2026-10-09'));
    expect(t.perFloor).toBe(2);
    expect(`${t.lit}${t.lit2}`.match(/M/g)).toHaveLength(20);
  });
});

describe('the footpath', () => {
  const bins = new Array(96).fill(0);
  bins[30] = 400;
  bins[40] = 100;
  bins[70] = 999; // after now: must not be drawn

  it('marks only walked quarter-hours up to now', () => {
    const p = footpath({ bins, total: 500, nowBin: 58 }, 58);
    expect(p.marks.match(/M/g)).toHaveLength(2);
    expect(p.now).toBeCloseTo(614.6, 0);
  });

  it('draws no marks before any steps arrive, and still knows where now is', () => {
    const p = footpath({ bins: new Array(96).fill(0), total: null, nowBin: 20 }, 20);
    expect(p.marks).toBe('');
    expect(footpath(null, 40).now).toBeCloseTo(427.1, 0);
  });

  it('puts the hour in its quarter-hour', () => {
    expect(binOf(0)).toBe(0);
    expect(binOf(14.67)).toBe(58);
    expect(binOf(23.99)).toBe(95);
  });
});

describe('the cloud', () => {
  it('gathers toward the next think and rains while one runs', () => {
    expect(cloud({ state: 'next', minutes: 40 }, 45)).toEqual({ mode: 'gather', fill: 0.11 });
    expect(cloud({ state: 'next', minutes: 2 }, 45).fill).toBeCloseTo(0.94);
    expect(cloud({ state: 'next', minutes: 120 }, 45).fill).toBe(0.06);
    expect(cloud({ state: 'now' }, 45).mode).toBe('rain');
  });

  it('has its own picture for every honest state', () => {
    expect(cloud({ state: 'late', minutes: 180 }, 45).mode).toBe('late');
    expect(cloud({ state: 'asleep', wakes: '07:00' }, 45).mode).toBe('mist');
    expect(cloud({ state: 'off' }, 45).mode).toBe('off');
    expect(cloud({ state: 'unknown', cadence: 45 }, 45)).toEqual({ mode: 'rest', fill: 0 });
  });
});

describe('the lamp', () => {
  it('never flashes more than three times a second', () => {
    expect(lampFor(null)).toBe('dark');
    expect(lampFor(30)).toBe('lubdub');
    // Two flashes a beat: 90 a minute is three a second.
    expect(lampFor(90)).toBe('lubdub');
    expect(lampFor(91)).toBe('flash');
    expect(lampFor(180)).toBe('flash');
    expect(lampFor(181)).toBe('steady');
    expect(lampFor(200)).toBe('steady');
  });
});
