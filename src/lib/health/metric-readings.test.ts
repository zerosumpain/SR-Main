import { describe, it, expect } from 'vitest';
import { buildReadings, MIN_SERIES_POINTS, type ReadingsInput } from './metric-readings';
import { allMetricDescriptors } from './metric-registry';
import type { HealthDay } from './series-30d-service';
import type { MetricResult } from './analytics/types';

function ok<T>(value: T): MetricResult<T> {
  return { value, sufficiency: 'ok', sampleSize: 28, asOf: '2026-09-07' };
}
/** The trap this whole module exists for: a confident struct of noughts. */
function thin<T>(zero: T): MetricResult<T> {
  return { value: zero, sufficiency: 'insufficient', sampleSize: 0, asOf: '2026-09-07' };
}

function day(i: number, over: Partial<HealthDay> = {}): HealthDay {
  const d = new Date('2026-08-01T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + i);
  return {
    i,
    date: d.toISOString().slice(0, 10),
    rec: 70,
    hrv: 50,
    rhr: 48,
    slept: 7.5,
    strain: 10,
    steps: 8000,
    weight: 80,
    ...over,
  };
}

function emptyInput(over: Partial<ReadingsInput> = {}): ReadingsInput {
  return {
    series: [],
    today: null,
    rhrBaseline: 0,
    readiness: null,
    volume: null,
    acwr: null,
    monotony: null,
    polarised: null,
    sleepRegularity: null,
    circadian: null,
    autonomic: null,
    recoveryDebt: null,
    vo2max: null,
    dashboard: null,
    ...over,
  };
}

describe('buildReadings — an empty payload', () => {
  const readings = buildReadings(emptyInput());

  // A missing key would make a card fall back to "unknown metric", which reads
  // as a bug. An honest gap has to be present and say what it needs.
  it('still answers for every metric the registry describes', () => {
    for (const d of allMetricDescriptors()) {
      expect(readings[d.id], d.id).toBeTruthy();
    }
  });

  it('marks every one unreadable, with a value of null and a reason', () => {
    for (const r of Object.values(readings)) {
      expect(r.readable, r.id).toBe(false);
      expect(r.value, r.id).toBeNull();
      expect(r.needs, r.id).toBeTruthy();
      expect(r.series, r.id).toEqual([]);
    }
  });
});

describe('buildReadings — the zero-struct trap', () => {
  // The single most important assertion in this file. Every analytic returns a
  // fully populated struct of noughts when it has not got the sample, so a
  // caller reading `.value.ratio` without the sufficiency flag prints
  // "detraining" over nothing at all.
  it('reports an insufficient analytic as UNREADABLE, not as a zero', () => {
    const readings = buildReadings(
      emptyInput({
        acwr: thin({ ratio: 0 }),
        monotony: thin({ monotony: 0 }),
        autonomic: thin({ score: 0 }),
        sleepRegularity: thin(0),
      }),
    );
    for (const id of ['acwr', 'monotony', 'autonomic', 'sri']) {
      expect(readings[id].readable, id).toBe(false);
      expect(readings[id].value, id).toBeNull();
    }
  });

  it('reports a sufficient analytic as readable, zero or not', () => {
    const readings = buildReadings(emptyInput({ acwr: ok({ ratio: 0.62 }) }));
    expect(readings.acwr.readable).toBe(true);
    expect(readings.acwr.value).toBe(0.62);
  });
});

describe('buildReadings — series', () => {
  const days = Array.from({ length: 30 }, (_, i) => day(i));

  it('pulls a 30-day series off the day rows', () => {
    const readings = buildReadings(emptyInput({ series: days, today: days[29] }));
    expect(readings.hrv.series.length).toBe(30);
    expect(readings.rhr.series.length).toBe(30);
    expect(readings.sleep.series.length).toBe(30);
    expect(readings.hrv.series[0].date < readings.hrv.series[29].date).toBe(true);
  });

  // A HealthDay carries no nulls — 0 IS its missing sentinel. Left in, a
  // fortnight without a sync draws a cliff to zero and a climb back out, and a
  // shape like that gets read as a real collapse.
  it('drops the zero sentinel rather than drawing a cliff', () => {
    // Indices 11..19 — nine days with nothing synced.
    const gapped = days.map((d, i) => (i > 10 && i < 20 ? { ...d, hrv: 0 } : d));
    const readings = buildReadings(emptyInput({ series: gapped, today: gapped[29] }));
    expect(readings.hrv.series.length).toBe(30 - 9);
    expect(readings.hrv.series.every((p) => p.value > 0)).toBe(true);
  });

  it('returns no series at all rather than a line between one point and itself', () => {
    const one = [day(0)];
    const readings = buildReadings(emptyInput({ series: one, today: one[0] }));
    expect(MIN_SERIES_POINTS).toBe(2);
    expect(readings.hrv.series).toEqual([]);
    // The reading itself is still there — one day is a value, just not a line.
    expect(readings.hrv.value).toBe(50);
  });

  it('carries the baseline a value should be read against', () => {
    const readings = buildReadings(
      emptyInput({
        series: days,
        today: days[29],
        rhrBaseline: 46,
        volume: { weekKm: 18, medianKm: 22 },
        dashboard: { weeks: [
          { weekStart: '2026-07-06', km: 20 },
          { weekStart: '2026-07-13', km: 24 },
          { weekStart: '2026-07-20', km: 18 },
        ] },
      }),
    );
    expect(readings.rhr.baseline).toBe(46);
    expect(readings.volume.baseline).toBe(22);
    expect(readings.volume.baselineLabel).toBe('12-week median');
    expect(readings.volume.series.length).toBe(3);
  });

  it('gives ACWR the daily LOAD behind it, which is what a reader wants to see', () => {
    const load = Array.from({ length: 28 }, (_, i) => ({ date: day(i).date, load: 40 + i }));
    const readings = buildReadings(emptyInput({ acwr: ok({ ratio: 1.1 }), dashboard: { load: { days: load } } }));
    expect(readings.acwr.series.length).toBe(28);
    expect(readings.acwr.seriesLabel).toContain('load');
    // Monotony reads the last seven of the same series.
    expect(readings.monotony.series.length).toBe(7);
  });

  it('takes efficiency from the beats-per-kilometre trend, with its baseline', () => {
    const readings = buildReadings(
      emptyInput({
        dashboard: {
          efficiency: {
            bkm: {
              latest7: 742,
              baseline28: 728,
              rolling7: [
                { date: '2026-08-01', value: 730 },
                { date: '2026-08-08', value: 742 },
              ],
            },
          },
        },
      }),
    );
    expect(readings.efficiency.readable).toBe(true);
    expect(readings.efficiency.value).toBe(742);
    expect(readings.efficiency.baseline).toBe(728);
    expect(readings.efficiency.series.length).toBe(2);
  });
});
