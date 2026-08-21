import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import PulseGrid from './PulseGrid.svelte';
import type { HealthDay } from '$lib/health/series-30d-service';
import {
  ramp,
  neutralRamp,
  rampGradient,
  neutralGradient,
  pulseBaseline,
  pulseExtent,
  divergingPosition,
  sequentialPosition,
  pulseTone,
  pulsePeakIndex,
  dayLabel,
  PULSE_DIRECTION,
  PULSE_SATURATION_Z,
  type PulseRowKey,
} from './utils';

/** rgb(r, g, b) → [r,g,b] so assertions can talk about colour, not strings. */
function rgb(css: string): [number, number, number] {
  const m = css.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
  if (!m) throw new Error(`not an rgb() string: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// Distance from grey in the same crude sense the eye uses here: how far the
// channels spread. A near-grey mid step is the failure this guards against.
function chroma(css: string): number {
  const [r, g, b] = rgb(css);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

const ACCENT_INK: [number, number, number] = [14, 91, 102];
const TREND_DOWN: [number, number, number] = [138, 58, 8];
const ACCENT: [number, number, number] = [196, 87, 10];

describe('ramp — diverging poles', () => {
  it('lands exactly on --accent-ink at the better pole', () => {
    expect(rgb(ramp(1))).toEqual(ACCENT_INK);
  });

  it('lands exactly on --trend-down at the worse pole', () => {
    expect(rgb(ramp(-1))).toEqual(TREND_DOWN);
  });

  it('passes through --accent on the way to the worse pole', () => {
    // The 0.82 stop is --accent itself, so the warm arm is orange before it is
    // burnt. Anything between must be at least as red as the mid orange.
    expect(rgb(ramp(-0.82))).toEqual(ACCENT);
  });

  it('is a near-cream neutral at the midpoint, lighter than the grid gutter', () => {
    const [r, g, b] = rgb(ramp(0));
    // --surface-rail (the gutter) is #e3d8c4 = 227,216,196.
    expect(r).toBeGreaterThan(227);
    expect(g).toBeGreaterThan(216);
    expect(b).toBeGreaterThan(196);
    // ...and still warm cream, not white.
    expect(r).toBeLessThan(250);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('clamps beyond the poles instead of running off the stop list', () => {
    expect(ramp(4)).toBe(ramp(1));
    expect(ramp(-4)).toBe(ramp(-1));
  });

  it('treats a non-finite position as the neutral midpoint', () => {
    expect(ramp(Number.NaN)).toBe(ramp(0));
    expect(ramp(Number.POSITIVE_INFINITY)).toBe(ramp(1));
  });

  it('sends the two arms to opposite sides of the colour wheel', () => {
    const [br, , bb] = rgb(ramp(0.7)); // better → cool: blue beats red
    expect(bb).toBeGreaterThan(br);
    const [wr, , wb] = rgb(ramp(-0.7)); // worse → warm: red beats blue
    expect(wr).toBeGreaterThan(wb);
  });

  it('keeps real chroma in the MID steps so they do not read as grey', () => {
    // A mid-range cell must still be legibly cool or warm.
    expect(chroma(ramp(0.3))).toBeGreaterThan(24);
    expect(chroma(ramp(-0.3))).toBeGreaterThan(60);
    expect(chroma(ramp(0.5))).toBeGreaterThan(40);
    expect(chroma(ramp(-0.5))).toBeGreaterThan(80);
  });

  it('darkens monotonically as it leaves the midpoint on either arm', () => {
    const lum = (c: string) => {
      const [r, g, b] = rgb(c);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const sign of [1, -1]) {
      for (let m = 0.1; m <= 1.0001; m += 0.1) {
        expect(lum(ramp(sign * m))).toBeLessThan(lum(ramp(sign * (m - 0.1))));
      }
    }
  });
});

describe('neutralRamp — no direction of good', () => {
  it('runs light to dark within one hue and never touches either pole', () => {
    expect(rgb(neutralRamp(0))[0]).toBeGreaterThan(230);
    expect(rgb(neutralRamp(1))[0]).toBeLessThan(100);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const c = rgb(neutralRamp(t));
      expect(c).not.toEqual(ACCENT_INK);
      expect(c).not.toEqual(TREND_DOWN);
      // Warm sepia: red is always the strongest channel, blue the weakest.
      expect(c[0]).toBeGreaterThanOrEqual(c[1]);
      expect(c[1]).toBeGreaterThanOrEqual(c[2]);
    }
  });

  it('clamps outside 0…1', () => {
    expect(neutralRamp(-3)).toBe(neutralRamp(0));
    expect(neutralRamp(3)).toBe(neutralRamp(1));
  });
});

describe('legend gradients are generated from the ramps', () => {
  it('starts on the worse pole, centres on the neutral, ends on the better pole', () => {
    const g = rampGradient(9);
    expect(g.startsWith('linear-gradient(to right, ')).toBe(true);
    const stops = g.slice('linear-gradient(to right, '.length, -1).split(', rgb').map((s, i) => (i ? `rgb${s}` : s));
    expect(stops).toHaveLength(9);
    expect(stops[0]).toBe(ramp(-1));
    expect(stops[4]).toBe(ramp(0));
    expect(stops[8]).toBe(ramp(1));
  });

  it('never emits fewer than two stops, however few are asked for', () => {
    expect(rampGradient(1).split('rgb(')).toHaveLength(3);
    expect(neutralGradient(0).split('rgb(')).toHaveLength(3);
  });

  it('gives the neutral legend the neutral ramp, not the diverging one', () => {
    const g = neutralGradient(5);
    expect(g).toContain(neutralRamp(0));
    expect(g).toContain(neutralRamp(1));
    expect(g).not.toContain(ramp(1));
  });
});

describe('pulseBaseline — median and robust spread over present days only', () => {
  it('ignores the 0 missing sentinel when taking the median', () => {
    const b = pulseBaseline([0, 0, 10, 20, 30]);
    expect(b.n).toBe(3);
    expect(b.median).toBe(20);
  });

  it('reports nothing for an empty window', () => {
    expect(pulseBaseline([])).toEqual({ median: 0, spread: 0, n: 0 });
    expect(pulseBaseline([0, 0, 0])).toEqual({ median: 0, spread: 0, n: 0 });
  });

  it('is not dragged by a single outlier the way a mean or a min/max would be', () => {
    const calm = [50, 51, 52, 53, 54, 55, 56];
    const spiked = [...calm, 400];
    expect(pulseBaseline(spiked).median).toBeCloseTo(53.5, 5);
    // A min/max normaliser would have stretched the scale ~50x here.
    expect(pulseBaseline(spiked).spread).toBeLessThan(pulseBaseline(calm).spread * 2);
  });

  it('falls back off MAD when more than half the window shares one value', () => {
    // A carried-forward sync gap: MAD is 0, so the IQR has to carry the scale.
    const b = pulseBaseline([60, 60, 60, 60, 60, 60, 61, 70, 80]);
    expect(b.spread).toBeGreaterThan(0);
  });

  it('never returns a zero spread while any day has data', () => {
    for (const vals of [[42], [7, 7, 7, 7], [1, 1, 1, 1, 1, 1, 1, 1]]) {
      const b = pulseBaseline(vals);
      expect(b.n).toBeGreaterThan(0);
      expect(b.spread).toBeGreaterThan(0);
    }
  });
});

describe('divergingPosition — median-anchored, robust, clamped', () => {
  const window = [40, 44, 48, 50, 52, 56, 60];
  const base = pulseBaseline(window);

  it('puts a day at the median exactly on the midpoint', () => {
    expect(divergingPosition(base.median, base, 'higher-is-better')).toBe(0);
    expect(divergingPosition(base.median, base, 'lower-is-better')).toBe(0);
  });

  it('treats 0 as missing rather than as a very bad day', () => {
    expect(divergingPosition(0, base, 'higher-is-better')).toBeNull();
    expect(divergingPosition(-5, base, 'lower-is-better')).toBeNull();
    expect(divergingPosition(Number.NaN, base, 'higher-is-better')).toBeNull();
  });

  it('returns null when there is no baseline to place a value against', () => {
    expect(divergingPosition(50, pulseBaseline([]), 'higher-is-better')).toBeNull();
  });

  it('flips sign with the direction instead of the row inverting its normaliser', () => {
    const high = divergingPosition(60, base, 'higher-is-better');
    const low = divergingPosition(60, base, 'lower-is-better');
    expect(high).not.toBeNull();
    expect(low).not.toBeNull();
    expect(high as number).toBeGreaterThan(0);
    expect(low as number).toBeCloseTo(-(high as number), 10);
  });

  it('saturates at exactly PULSE_SATURATION_Z robust deviations', () => {
    const at = base.median + PULSE_SATURATION_Z * base.spread;
    expect(divergingPosition(at, base, 'higher-is-better')).toBeCloseTo(1, 10);
    expect(divergingPosition(at * 100, base, 'higher-is-better')).toBe(1);
    const below = base.median - PULSE_SATURATION_Z * base.spread;
    expect(divergingPosition(below, base, 'higher-is-better')).toBeCloseTo(-1, 10);
  });

  it('stays inside -1…1 for every day of a real-shaped window', () => {
    for (const v of [...window, 1, 9999]) {
      const p = divergingPosition(v, base, 'higher-is-better');
      expect(p).not.toBeNull();
      expect(p as number).toBeGreaterThanOrEqual(-1);
      expect(p as number).toBeLessThanOrEqual(1);
    }
  });

  it('does not let one outlier flatten the rest of the row into neutral', () => {
    const spiked = pulseBaseline([...window, 400]);
    const p = divergingPosition(40, spiked, 'higher-is-better');
    expect(Math.abs(p as number)).toBeGreaterThan(0.3);
  });
});

describe('sequentialPosition — the no-direction path', () => {
  const ext = pulseExtent([0, 78.2, 79.4, 80.6, 0]);

  it('ignores the missing sentinel at both ends of the extent', () => {
    expect(ext).toEqual({ min: 78.2, max: 80.6, n: 3 });
  });

  it('maps min to 0 and max to 1', () => {
    expect(sequentialPosition(78.2, ext)).toBeCloseTo(0, 10);
    expect(sequentialPosition(80.6, ext)).toBeCloseTo(1, 10);
  });

  it('treats 0 as missing and an empty window as unplaceable', () => {
    expect(sequentialPosition(0, ext)).toBeNull();
    expect(sequentialPosition(80, pulseExtent([]))).toBeNull();
  });

  it('sits mid-ramp when every day shares one value', () => {
    expect(sequentialPosition(80, pulseExtent([80, 80, 80]))).toBe(0.5);
  });

  it('clamps a value from outside the window', () => {
    expect(sequentialPosition(200, ext)).toBe(1);
    expect(sequentialPosition(1, ext)).toBe(0);
  });
});

describe('pulseTone — colour is never the only encoding', () => {
  it('says "no data" for a missing day', () => {
    expect(pulseTone(null, 'higher-is-better')).toBe('no data');
    expect(pulseTone(null, 'neutral')).toBe('no data');
  });

  it('reads a direction-bearing row in plain words', () => {
    expect(pulseTone(0, 'higher-is-better')).toBe('at baseline');
    expect(pulseTone(0.05, 'lower-is-better')).toBe('at baseline');
    expect(pulseTone(0.4, 'higher-is-better')).toBe('better than baseline');
    expect(pulseTone(0.9, 'higher-is-better')).toBe('much better than baseline');
    expect(pulseTone(-0.4, 'higher-is-better')).toBe('worse than baseline');
    expect(pulseTone(-0.9, 'higher-is-better')).toBe('much worse than baseline');
  });

  it('says better/worse, not above/below, so a lower-is-better row reads right', () => {
    // A LOW resting HR is a GOOD day. `divergingPosition` has already flipped
    // the sign, so the words must not re-introduce the raw direction.
    const base = pulseBaseline([50, 52, 54, 56, 58]);
    const goodDay = divergingPosition(50, base, 'lower-is-better');
    expect(pulseTone(goodDay, 'lower-is-better')).toContain('better');
    expect(pulseTone(goodDay, 'lower-is-better')).not.toContain('below');
  });

  it('passes no verdict on a neutral row — a reading, not a judgement', () => {
    expect(pulseTone(0.9, 'neutral')).toBe('high in range');
    expect(pulseTone(0.5, 'neutral')).toBe('mid range');
    expect(pulseTone(0.1, 'neutral')).toBe('low in range');
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(pulseTone(t, 'neutral')).not.toMatch(/better|worse|baseline/);
    }
  });
});

describe('PULSE_DIRECTION', () => {
  it('declares a direction for every row key exactly once', () => {
    const keys: PulseRowKey[] = ['rec', 'hrv', 'rhr', 'slept', 'strain', 'steps', 'weight'];
    for (const k of keys) expect(PULSE_DIRECTION[k]).toBeTruthy();
    expect(Object.keys(PULSE_DIRECTION).sort()).toEqual([...keys].sort());
  });

  it('is the single source of truth: RHR down, weight neutral, the rest up', () => {
    expect(PULSE_DIRECTION.rhr).toBe('lower-is-better');
    expect(PULSE_DIRECTION.weight).toBe('neutral');
    expect(PULSE_DIRECTION.rec).toBe('higher-is-better');
    expect(PULSE_DIRECTION.hrv).toBe('higher-is-better');
    expect(PULSE_DIRECTION.slept).toBe('higher-is-better');
    expect(PULSE_DIRECTION.strain).toBe('higher-is-better');
    expect(PULSE_DIRECTION.steps).toBe('higher-is-better');
  });
});

describe('pulsePeakIndex — unchanged behaviour', () => {
  it('takes the max for a higher-is-better row', () => {
    expect(pulsePeakIndex('rec', [30, 90, 55])).toBe(1);
    expect(pulsePeakIndex('steps', [1000, 2000, 16000, 900])).toBe(2);
  });

  it('takes the min for RHR, the one lower-is-better row', () => {
    expect(pulsePeakIndex('rhr', [58, 49, 61])).toBe(1);
  });

  it('skips values at or below 0 rather than calling a sync gap the best day', () => {
    expect(pulsePeakIndex('rhr', [0, 0, 55, 0])).toBe(2);
    expect(pulsePeakIndex('hrv', [0, 44, 0, 44])).toBe(1);
    expect(pulsePeakIndex('rhr', [-3, 0, 70])).toBe(2);
  });

  it('keeps the FIRST index on a tie', () => {
    expect(pulsePeakIndex('rec', [80, 80, 80])).toBe(0);
    expect(pulsePeakIndex('rhr', [50, 50, 60])).toBe(0);
  });

  it('returns -1 when there is nothing to rank', () => {
    expect(pulsePeakIndex('rec', [])).toBe(-1);
    expect(pulsePeakIndex('rec', [0, 0, 0])).toBe(-1);
    expect(pulsePeakIndex('rhr', [0, 0])).toBe(-1);
  });

  it('ranks the neutral weight row by max, as it always did', () => {
    // The RING is suppressed for a neutral row in the component; the helper's
    // own contract is unchanged so nothing else that calls it shifts.
    expect(pulsePeakIndex('weight', [80, 82, 79])).toBe(1);
  });
});

describe('dayLabel', () => {
  it('adds a weekday index without disturbing the existing fields', () => {
    // 2026-08-17 is a Monday.
    expect(dayLabel('2026-08-17')).toEqual({ dom: 17, mon: 'AUG', dow: 'M', dowIndex: 1 });
    expect(dayLabel('2026-08-16').dowIndex).toBe(0);
    expect(dayLabel('2026-08-23').dowIndex).toBe(0);
  });
});

/* The helpers above are pure, but the grid is where they have to line up with
   the markup. These render it on the server — no DOM needed — and check the
   things that used to be silently wrong: a hard-coded 30 columns, a legend
   holding its own copy of the palette, and a "scaled to its own range" claim
   that was not true. */

function day(i: number, over: Partial<HealthDay> = {}): HealthDay {
  const d = new Date(Date.UTC(2026, 6, 23 + i));
  return {
    i,
    date: d.toISOString().slice(0, 10),
    rec: 50 + ((i * 7) % 40),
    hrv: 40 + ((i * 3) % 25),
    rhr: 50 + (i % 9),
    slept: 6 + (i % 5) * 0.4,
    strain: 8 + ((i * 2) % 11),
    steps: i % 6 === 0 ? 0 : 6000 + i * 111, // 0 is the missing sentinel
    weight: 80 - (i % 4) * 0.3,
    ...over,
  };
}

const html = (series: HealthDay[]) => render(PulseGrid, { props: { series } }).body;

describe('PulseGrid renders what the helpers decided', () => {
  it('drives the column count from series.length, not a hard-coded 30', () => {
    expect(html(Array.from({ length: 30 }, (_, i) => day(i)))).toContain('--cols: 30');
    // The old grid pinned repeat(30, …) in the rows AND the axis, so any other
    // length slid the cells out from under the axis without any error.
    expect(html(Array.from({ length: 14 }, (_, i) => day(i)))).toContain('--cols: 14');
    expect(html(Array.from({ length: 45 }, (_, i) => day(i)))).toContain('--cols: 45');
    expect(html(Array.from({ length: 14 }, (_, i) => day(i)))).toContain('14 DAYS');
  });

  it('builds the legend gradient out of ramp() itself', () => {
    const body = html(Array.from({ length: 30 }, (_, i) => day(i)));
    expect(body).toContain(rampGradient());
    // Both poles and the midpoint must appear because the ramp produced them,
    // not because a second gradient was typed out in the stylesheet.
    expect(body).toContain(ramp(-1));
    expect(body).toContain(ramp(0));
    expect(body).toContain(ramp(1));
  });

  it('no longer claims each row is scaled to its own range — it says what it does', () => {
    const body = html(Array.from({ length: 30 }, (_, i) => day(i)));
    expect(body).not.toContain('scaled to its own range');
    expect(body).not.toContain('RHR inverted');
    expect(body).toContain('median');
  });

  it('paints a lower-is-better row by direction, not by an inverted normaliser', () => {
    const body = html(Array.from({ length: 30 }, (_, i) => day(i)));
    const rhr = body.split('RESTING HR')[1].split('h-pg-rowlabel ')[0];
    // The lowest resting HR in the window is the BEST day, so it must be cool.
    const best = rhr.match(/aria-label="[^"]*RESTING HR 50bpm[^"]*"/)?.[0] ?? '';
    expect(best).toContain('better than baseline');
    const worst = rhr.match(/aria-label="[^"]*RESTING HR 58bpm[^"]*"/)?.[0] ?? '';
    expect(worst).toContain('worse than baseline');
  });

  it('hatches the missing sentinel instead of colouring it as a very bad day', () => {
    const body = html(Array.from({ length: 30 }, (_, i) => day(i)));
    const steps = body.split('>STEPS<')[1].split('h-pg-rowlabel ')[0];
    const missing = steps.match(/<button[^>]*missing[^>]*>/g) ?? [];
    expect(missing.length).toBe(5); // i % 6 === 0 over 30 days
    for (const b of missing) {
      expect(b).not.toContain('--c:'); // no colour at all, so none can be read
      expect(b).toContain('no data');
    }
  });

  it('gives the neutral weight row no verdict and no best-day ring', () => {
    const body = html(Array.from({ length: 30 }, (_, i) => day(i)));
    const weight = body.split('>WEIGHT<')[1];
    expect(weight).not.toContain('peak');
    expect(weight).not.toMatch(/aria-label="[^"]*(better|worse) than baseline/);
    expect(weight).toContain('no direction of good');
  });

  it('drops the weight row entirely when nothing was weighed', () => {
    const body = html(Array.from({ length: 30 }, (_, i) => day(i, { weight: 0 })));
    expect(body).not.toContain('>WEIGHT<');
    expect(body).not.toContain('no direction of good');
  });

  it('survives an empty series and two days sharing a date', () => {
    expect(() => html([])).not.toThrow();
    // Keyed by index, never by date — two days on one date used to be an
    // each_key_duplicate that blanked the page while SSR still looked fine.
    const dupes = Array.from({ length: 30 }, (_, i) => day(i, { date: '2026-08-01' }));
    expect(() => html(dupes)).not.toThrow();
  });
});
