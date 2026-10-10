import { describe, expect, it } from 'vitest';
import { binOf, cloud, contrast, footpath, lampFor, ridge, skyAt, skyVars, starfield, sunAltitude, town, TOWN_DAYS } from './place';
import { DAY_TONE_ALT, luminance, over } from './sky';
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
    // Astronomical twilight already thins them, so -12° is not the dead of night.
    expect(skyAt(-15, true).stars).toBe(1);
    expect(skyAt(-12, true).stars).toBeLessThan(0.8);
  });

  // Every altitude the sky can take, a degree at a time, climbing and sinking.
  const sweep = () => {
    const out: Array<{ alt: number; rising: boolean; s: ReturnType<typeof skyAt> }> = [];
    for (let alt = -30; alt <= 70; alt++) for (const rising of [true, false]) out.push({ alt, rising, s: skyAt(alt, rising) });
    return out;
  };
  const cream: [number, number, number] = [237, 228, 212];
  const rgb = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

  const ink: [number, number, number] = [26, 16, 8];

  it('keeps every piece of text on the sky at 4.5:1, at every altitude, rising and setting', () => {
    const check = (s: ReturnType<typeof skyAt>, at: string) => {
      // Cream on the deep sky, ink on the pale daytime one (HeroPlace's --type).
      const type = s.tone === 'light' ? ink : cream;
      for (const bg of [s.top, s.mid, s.low]) {
        // The title and values at full; the faintest on-sky type at 72%.
        for (const a of [1, 0.86, 0.82, 0.78, 0.74, 0.72])
          expect(contrast([...type, a], bg), `${s.tone} type ${a} at ${at} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        // The kickers, the dateline and the plate's link, in the tone's own accents.
        expect(contrast(rgb(s.accent), bg), `accent at ${at} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(rgb(s.accentInk), bg), `accent ink at ${at} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    };
    for (const { alt, rising, s } of sweep()) check(s, `${alt}° ${rising ? 'rising' : 'setting'}`);
    // Half degrees too, the old range, so no blend between keys slips through.
    for (let alt = -40; alt <= 70; alt += 0.5) for (const rising of [true, false]) check(skyAt(alt, rising), `${alt}°`);
  });

  it('turns type from cream to ink in one step, at the same altitude climbing and sinking', () => {
    for (const rising of [true, false]) {
      for (let alt = -40; alt <= 70; alt += 0.5) expect(skyAt(alt, rising).tone).toBe(alt >= DAY_TONE_ALT ? 'light' : 'dark');
      // Either side of the step the two palettes are far apart: no half-way sky for either tone.
      expect(luminance(skyAt(DAY_TONE_ALT, rising).top)).toBeGreaterThan(luminance(skyAt(DAY_TONE_ALT - 0.5, rising).top) * 4);
    }
    // The day accents are the deep ones; the night's are the site's on-dark ones.
    expect(skyAt(30, true).accent).toBe('#6e2c06');
    expect(skyAt(30, true).accentInk).toBe('#164651');
  });

  it('keeps the site\'s own on-dark accents until the sky gets light', () => {
    for (const alt of [-40, -18, -12, -8]) {
      expect(skyAt(alt, true).accent).toBe('#e8863a');
      expect(skyAt(alt, false).accentInk).toBe('#7fb8c0');
    }
    // By day they are a shade lighter, the same hues.
    expect(skyAt(30, true).accent).not.toBe('#e8863a');
  });

  it('keeps the ground and the walk below at 4.5:1 for the page\'s own on-dark type', () => {
    // The showcase's chapter skies (PlaceShowcase.svelte), each under the day's wash.
    const chapters = ['#0e1517', '#0f181b', '#111916', '#121a17', '#0f1513', '#15100e', '#1a1210', '#22160f', '#11171a', '#131b1d', '#161f20'];
    for (const { alt, rising, s } of sweep()) {
      const grounds = [s.ground, s.street, over(s.wash, s.street), ...chapters.map((c) => over(s.wash, c))];
      for (const bg of grounds) {
        const at = `${alt}° ${rising ? 'rising' : 'setting'} on ${bg}`;
        // The faintest type below the hero is cream at 55% (the preview stamp).
        expect(contrast([...cream, 0.55], bg), `cream at ${at}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast([232, 134, 58], bg), `accent at ${at}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast([127, 184, 192], bg), `accent ink at ${at}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('reads as day by day: a clear blue overhead and a light skyline', () => {
    const night = skyAt(-30, false);
    for (const alt of [14, 30, 45, 60]) {
      const s = skyAt(alt, true);
      const [r, g, b] = rgb(s.top);
      expect(b - r, `blue at ${alt}°`).toBeGreaterThan(90);
      expect(b).toBeGreaterThan(g);
      expect(luminance(s.top)).toBeGreaterThan(luminance(night.top) * 10);
      // The haze along the skyline is a pale, bright horizon.
      expect(luminance(over(s.haze, s.low))).toBeGreaterThan(0.3);
      // A pale daytime sky, not a deep one: midday must not pass for dusk.
      for (const c of [s.top, s.mid, s.low]) expect(luminance(c), `${c} at ${alt}°`).toBeGreaterThan(0.4);
      expect(s.tone).toBe('light');
      expect(s.daylight).toBeGreaterThan(0.9);
      expect(s.windows).toBeLessThan(0.2);
    }
    // A fuller blue overhead as the sun climbs.
    expect(rgb(skyAt(60, true).top)[2]).toBeGreaterThan(rgb(skyAt(14, true).top)[2]);
    // Night is ink, every star out, every window strong.
    expect(luminance(night.top)).toBeLessThan(0.005);
    expect(night.stars).toBe(1);
    expect(night.windows).toBe(1);
    expect(night.daylight).toBe(0);
  });

  it('warms the skyline at the turn of the day, redder at sunset than at sunrise', () => {
    for (const alt of [-1, 1, 3]) {
      const rise = rgb(over(skyAt(alt, true).haze, skyAt(alt, true).low));
      const set = rgb(over(skyAt(alt, false).haze, skyAt(alt, false).low));
      // Warm: more red than blue in the glow, and the sunset's the redder.
      expect(rise[0]).toBeGreaterThan(rise[2]);
      expect(set[0]).toBeGreaterThan(set[2]);
      expect(set[1] / set[0]).toBeLessThan(rise[1] / rise[0]);
    }
    expect(skyAt(1, true).warmth).toBe(1);
    expect(skyAt(-20, true).warmth).toBe(0);
    expect(skyAt(40, true).warmth).toBe(0);
    expect(skyAt(8, false).warmth).toBeGreaterThan(0.3);
  });

  it('names the blue hour and the golden hour', () => {
    expect(skyAt(-4, true).word).toBe('blue hour');
    expect(skyAt(-4, false).word).toBe('blue hour');
    expect(skyAt(8, true).word).toBe('golden hour');
    expect(skyAt(-9, true).word).toBe('dawn');
    expect(skyAt(-20, true).word).toBe('night');
  });

  it('eases from one degree to the next, with no jump anywhere', () => {
    for (const rising of [true, false]) {
      let prev = skyAt(-31, rising);
      for (let alt = -30; alt <= 70; alt++) {
        const s = skyAt(alt, rising);
        // The one deliberate step: the tone change (tested above).
        if (s.tone !== prev.tone) {
          prev = s;
          continue;
        }
        for (const k of ['top', 'mid', 'low'] as const) {
          const d = rgb(s[k]).map((v, i) => Math.abs(v - rgb(prev[k])[i]));
          expect(Math.max(...d), `${k} at ${alt}°`).toBeLessThanOrEqual(16);
        }
        expect(s.daylight).toBeGreaterThanOrEqual(prev.daylight);
        expect(s.windows).toBeLessThanOrEqual(prev.windows);
        prev = s;
      }
    }
  });

  it('carries a light model the scenery can read, every field in range', () => {
    for (const { rising, s } of sweep()) {
      for (const v of [s.stars, s.daylight, s.warmth, s.windows, s.moon, s.sunY]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(s.side).toBe(rising ? 'east' : 'west');
      for (const c of [s.top, s.mid, s.low, s.ground, s.street, s.sun, s.accent, s.accentInk]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      for (const c of [s.haze, s.wash]) expect(c).toMatch(/^rgba\(\d+,\d+,\d+,[\d.]+\)$/);
    }
    expect(skyAt(-1.5, true).sunUp).toBe(false);
    expect(skyAt(0, true).sunUp).toBe(true);
    expect(skyAt(70, true).sunY).toBe(1);
    expect(skyAt(-10, true).sunY).toBe(0);
    expect(skyAt(-30, true).moon).toBe(1);
    expect(skyAt(20, true).moon).toBe(0);
  });

  it('hands the sky to CSS as custom properties, and nothing about where', () => {
    const v = skyVars(skyAt(5, false));
    for (const k of ['--sky-top', '--sky-mid', '--sky-low', '--sky-haze', '--sky-ground', '--sky-street', '--sky-wash', '--sky-sun', '--sky-accent', '--sky-accent-ink', '--stars', '--daylight', '--warmth', '--windows', '--moon', '--sun-y', '--sun-x'])
      expect(v).toContain(`${k}:`);
    expect(v).not.toMatch(/lat|lon|zone|offset/i);
    // The sun stands left of centre while it climbs, right while it sinks.
    const x = (s: string) => Number(s.match(/--sun-x:(\d+)%/)![1]);
    expect(x(skyVars(skyAt(5, true)))).toBeLessThan(50);
    expect(x(v)).toBeGreaterThan(50);
    expect(x(skyVars(skyAt(70, true)))).toBe(50);
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
    // Towers stand across the whole width, the first at the left edge, the last to the right.
    const xs = [...a.d.matchAll(/[MH](-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(1000);
    // The farther range stands up behind: its tallest is at least the near's.
    const tops = (d: string) => [...d.matchAll(/V(-?[\d.]+)H/g)].map((m) => Number(m[1]));
    expect(Math.min(...tops(a.far))).toBeLessThanOrEqual(Math.min(...tops(a.d)) + 0.01);
    expect(a.lights).toMatch(/^M/);
  });

  it('stands its towers as tall as the busiest day under them', () => {
    // One busy day among quiet ones: the near range's tallest tower is that day's.
    const r = ridge(record('2026-03-01', '2026-10-09', (i) => (i === 90 ? 40 : 1)), '2026-10-09')!;
    const tops = [...r.d.matchAll(/V(-?[\d.]+)H/g)].map((m) => Number(m[1]));
    expect(Math.min(...tops)).toBeLessThan(60);
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
