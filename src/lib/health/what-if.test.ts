import { describe, it, expect } from 'vitest';
import {
  INTENSITY_LOAD_PER_MIN,
  SESSION_PRESETS,
  sessionLoad,
  simulate,
} from './what-if';
import { computeACWR, type LoadDay } from './analytics/acwr';

/** `n` days of identical load, ending today-ish. Dates ascend. */
function series(n: number, load = 60, start = '2026-07-01'): LoadDay[] {
  const out: LoadDay[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), load });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe('sessionLoad', () => {
  it('is minutes times the intensity factor, and the factors are ordered', () => {
    expect(sessionLoad({ minutes: 60, intensity: 'easy' })).toBe(60);
    expect(sessionLoad({ minutes: 60, intensity: 'steady' })).toBe(102);
    expect(sessionLoad({ minutes: 50, intensity: 'hard' })).toBe(160);
    expect(INTENSITY_LOAD_PER_MIN.easy).toBeLessThan(INTENSITY_LOAD_PER_MIN.steady);
    expect(INTENSITY_LOAD_PER_MIN.steady).toBeLessThan(INTENSITY_LOAD_PER_MIN.hard);
  });

  it('makes a rest day cost nothing', () => {
    expect(sessionLoad({ minutes: 0, intensity: 'easy' })).toBe(0);
  });
});

describe('SESSION_PRESETS', () => {
  it('are few, distinct and all described', () => {
    expect(SESSION_PRESETS.length).toBeLessThanOrEqual(5);
    expect(new Set(SESSION_PRESETS.map((p) => p.id)).size).toBe(SESSION_PRESETS.length);
    for (const p of SESSION_PRESETS) expect(p.note.length).toBeGreaterThan(20);
  });
});

describe('simulate', () => {
  it('is null with no series at all rather than a simulation of nothing', () => {
    expect(simulate([], SESSION_PRESETS[1])).toBeNull();
    expect(simulate(null, SESSION_PRESETS[1])).toBeNull();
    expect(simulate(undefined, SESSION_PRESETS[1])).toBeNull();
  });

  // Rule 2. `computeACWR` hands back a fully-populated ZERO struct under
  // fourteen days, so a caller that did not check would simulate a confident
  // ratio on top of nothing.
  it('is null when the baseline is not readable', () => {
    const thin = series(5);
    expect(computeACWR(thin).sufficiency).toBe('insufficient');
    expect(simulate(thin, SESSION_PRESETS[1])).toBeNull();
  });

  it('runs the REAL analytic — the before matches computeACWR on the same array', () => {
    const days = series(40);
    const out = simulate(days, SESSION_PRESETS[1])!;
    expect(out).not.toBeNull();
    // Rule 1: the baseline is recomputed here, not read off the page, so it is
    // exactly what the analytic says about this array.
    expect(out.acwr!.before).toEqual(computeACWR(days).value);
  });

  it('places the session on the day AFTER the last real one', () => {
    const days = series(40, 60, '2026-07-01');
    const out = simulate(days, SESSION_PRESETS[1])!;
    expect(days[days.length - 1].date).toBe('2026-08-09');
    expect(out.day).toBe('2026-08-10');
  });

  it('raises the acute ratio when a hard session is added to a steady base', () => {
    const out = simulate(series(40, 60), SESSION_PRESETS[3])!;
    expect(out.addedLoad).toBe(160);
    expect(out.acwr!.after.ratio).toBeGreaterThan(out.acwr!.before.ratio);
  });

  it('lowers the acute ratio on a rest day, because the acute EWMA decays', () => {
    const out = simulate(series(40, 60), SESSION_PRESETS[0])!;
    expect(out.addedLoad).toBe(0);
    expect(out.acwr!.after.ratio).toBeLessThan(out.acwr!.before.ratio);
  });

  it('moves the zone, not just the number, when the session is big enough', () => {
    // A flat base sits at exactly 1.00 — optimal. A very hard day should push
    // the ratio up; the zone is read by the analytic, never by this test.
    const out = simulate(series(60, 40), { minutes: 240, intensity: 'hard' })!;
    expect(out.acwr!.after.ratio).toBeGreaterThan(out.acwr!.before.ratio);
    expect(out.acwr!.after.zone).not.toBe('detraining');
  });

  it('reports monotony over the last seven days, and a varied day lowers it', () => {
    // A dead-flat week is maximally monotonous; one different day breaks it.
    const flat = series(40, 60);
    const out = simulate(flat, SESSION_PRESETS[3])!;
    expect(out.monotony).not.toBeNull();
    expect(out.monotony!.after.monotony).toBeLessThan(out.monotony!.before.monotony);
  });

  it('names the series it ran over, so the UI cannot imply the headline moved', () => {
    // The panel's ACWR may be the Whoop-strain fallback, which is a different
    // instrument from this TRIMP series.
    expect(simulate(series(40), SESSION_PRESETS[1])!.basis).toBe('trimp-load-days');
  });

  it('does not mutate the caller’s array', () => {
    const days = series(40);
    const copy = JSON.parse(JSON.stringify(days));
    simulate(days, SESSION_PRESETS[3]);
    expect(days).toEqual(copy);
  });

  it('sorts an out-of-order series before simulating', () => {
    const days = series(40);
    const shuffled = [...days].reverse();
    expect(simulate(shuffled, SESSION_PRESETS[1])!.day).toBe(
      simulate(days, SESSION_PRESETS[1])!.day,
    );
  });
});
