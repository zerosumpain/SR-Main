import { describe, it, expect } from 'vitest';
import { segmentForm, formLabel, MIN_EFFORTS_FOR_FORM, type FormEffort } from './form';

const DAY = 86_400;
const T0 = 1_700_000_000;

/** Efforts oldest-first, one a week apart. */
function efforts(durations: number[]): FormEffort[] {
  return durations.map((durationS, i) => ({ durationS, startedAt: T0 + i * 7 * DAY }));
}

describe('segmentForm', () => {
  it('reports unknown below the floor, but still answers the PB questions', () => {
    const form = segmentForm(efforts([300, 290, 295]));
    expect(form.direction).toBe('unknown');
    expect(form.deltaPct).toBeNull();
    expect(form.pbDurationS).toBe(290);
    expect(form.spark).toEqual([300, 290, 295]);
  });

  it('is empty for no efforts at all', () => {
    const form = segmentForm([]);
    expect(form.direction).toBe('unknown');
    expect(form.pbDurationS).toBeNull();
    expect(form.spark).toEqual([]);
  });

  it('calls a falling time improving, and says so with the sign explained', () => {
    // Earlier median 320, recent median 290 → −9.4%.
    const form = segmentForm(efforts([330, 320, 310, 300, 290, 285]));
    expect(form.direction).toBe('improving');
    expect(form.deltaPct).toBeLessThan(0);
    expect(formLabel(form)).toMatch(/quicker over the last 3/);
  });

  it('calls a rising time slipping', () => {
    const form = segmentForm(efforts([280, 285, 290, 310, 320, 330]));
    expect(form.direction).toBe('slipping');
    expect(form.deltaPct).toBeGreaterThan(0);
    expect(formLabel(form)).toMatch(/slower over the last 3/);
  });

  it('calls a flat run holding rather than inventing a trend', () => {
    const form = segmentForm(efforts([300, 301, 299, 300, 302, 299]));
    expect(form.direction).toBe('holding');
    expect(formLabel(form)).toMatch(/Holding/);
  });

  it('is not thrown by one effort spent waiting at a gate', () => {
    // A mean would read the 600 as a collapse; the median ignores it.
    const form = segmentForm(efforts([330, 320, 310, 290, 600, 288]));
    expect(form.direction).toBe('improving');
  });

  it('measures the gap from the RECENT best to the all-time PB', () => {
    const form = segmentForm(efforts([300, 280, 290, 295, 292, 291]));
    expect(form.pbDurationS).toBe(280);
    // Recent window is the last three: 295, 292, 291 → best 291.
    expect(form.gapPct).toBeCloseTo((291 - 280) / 280, 5);
  });

  it('counts the days from the PB to NOW, not to the latest effort', () => {
    const rows = efforts([300, 280, 290, 295, 292, 291]);
    const latest = rows[rows.length - 1].startedAt;
    // PB is index 1 — four weeks before the last effort.
    const pbAt = rows[1].startedAt;

    // A segment nobody has touched for a year: the PB is a year old, not 28 days.
    const ayear = segmentForm(rows, { now: latest + 365 * DAY });
    expect(ayear.daysSincePb).toBe(Math.round((latest + 365 * DAY - pbAt) / DAY));
    expect(ayear.daysSincePb).toBeGreaterThan(365);

    // Measured right after the last effort it is the old 28.
    expect(segmentForm(rows, { now: latest }).daysSincePb).toBe(28);
  });

  it('drops zero and non-finite durations rather than ranking them', () => {
    const form = segmentForm([
      { durationS: 0, startedAt: T0 },
      { durationS: Number.NaN, startedAt: T0 + DAY },
      ...efforts([330, 320, 310, 300, 290, 285]),
    ]);
    expect(form.pbDurationS).toBe(285);
    expect(form.spark).not.toContain(0);
  });

  it('reads efforts in time order however they arrive', () => {
    const shuffled = [...efforts([330, 320, 310, 300, 290, 285])].reverse();
    expect(segmentForm(shuffled).direction).toBe('improving');
  });

  it('needs MIN_EFFORTS_FOR_FORM before it will name a direction', () => {
    const just = segmentForm(efforts(Array.from({ length: MIN_EFFORTS_FOR_FORM }, (_, i) => 320 - i * 10)));
    expect(just.direction).not.toBe('unknown');
    const oneShort = segmentForm(
      efforts(Array.from({ length: MIN_EFFORTS_FOR_FORM - 1 }, (_, i) => 320 - i * 10)),
    );
    expect(oneShort.direction).toBe('unknown');
  });
});
