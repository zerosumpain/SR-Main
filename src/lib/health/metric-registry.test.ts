import { describe, it, expect } from 'vitest';
import {
  allMetricDescriptors,
  bandFor,
  metricDescriptor,
  methodologyFor,
  relatedMetrics,
} from './metric-registry';
import { ACWR_BANDS } from './analytics/acwr';
import { SRI_TARGET } from './analytics/sri';

describe('the registry’s own integrity', () => {
  it('has no duplicate ids', () => {
    const ids = allMetricDescriptors().map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Rule 4: a drill that offers "how this is computed" and opens an empty
  // drawer is worse than one that does not offer it. So every id named here
  // must actually resolve in METHODOLOGY.
  it('every methodologyId it names resolves to a real entry', () => {
    for (const d of allMetricDescriptors()) {
      if (d.methodologyId == null) continue;
      expect(methodologyFor(d), `${d.id} → ${d.methodologyId}`).not.toBeNull();
    }
  });

  it('every descriptor says what it is and what moves it', () => {
    for (const d of allMetricDescriptors()) {
      expect(d.what.length, d.id).toBeGreaterThan(20);
      expect(d.moves.length, d.id).toBeGreaterThan(20);
      expect(d.window.length, d.id).toBeGreaterThan(1);
    }
  });

  // Rule 3: half these metrics are better going DOWN. A generic up-arrow on
  // all of them is worse than no arrow, so the direction is asserted per id
  // rather than left to whatever a component guesses.
  it('points the metrics that are better LOW downwards', () => {
    for (const id of ['rhr', 'monotony', 'circadian', 'efficiency']) {
      expect(metricDescriptor(id)?.higherIsBetter, id).toBe(false);
    }
    for (const id of ['readiness', 'recovery', 'hrv', 'sleep', 'acwr', 'sri', 'autonomic']) {
      expect(metricDescriptor(id)?.higherIsBetter, id).toBe(true);
    }
  });

  it('leaves no gap or overlap in a banded ladder', () => {
    for (const d of allMetricDescriptors()) {
      if (d.bands.length < 2) continue;
      for (let i = 1; i < d.bands.length; i++) {
        // Each band starts exactly where the one below it ended.
        expect(d.bands[i].from, `${d.id} band ${i}`).toBe(d.bands[i - 1].to);
      }
      expect(d.bands[0].from, `${d.id} floor`).toBeNull();
      expect(d.bands[d.bands.length - 1].to, `${d.id} ceiling`).toBeNull();
    }
  });
});

describe('bandFor', () => {
  const acwr = metricDescriptor('acwr')!;

  it('reads the analytic’s OWN constants, not retyped numbers', () => {
    // If ACWR_BANDS moves, this moves with it — the ladder on the drill and the
    // zone the tripwires apply must never disagree on one screen.
    expect(bandFor(acwr, ACWR_BANDS.detraining - 0.01)?.tone).toBe('warn');
    expect(bandFor(acwr, ACWR_BANDS.undertraining)?.label).toContain('Optimal');
    expect(bandFor(acwr, ACWR_BANDS.optimal - 0.01)?.label).toContain('Optimal');
    expect(bandFor(acwr, ACWR_BANDS.caution + 0.01)?.label).toContain('Danger');
  });

  it('puts a value exactly on an edge in the band ABOVE it', () => {
    expect(bandFor(acwr, ACWR_BANDS.optimal)?.label).toContain('Caution');
  });

  it('bands SRI against its shared target', () => {
    const sri = metricDescriptor('sri')!;
    expect(bandFor(sri, SRI_TARGET)?.tone).toBe('good');
    expect(bandFor(sri, SRI_TARGET - 1)?.tone).toBe('plain');
  });

  // Rule 1 and the zero-struct trap in one: an insufficient MetricResult
  // carries a confident `ratio: 0`, so a caller that has not checked
  // sufficiency must not be handed "detraining" as though it were measured.
  it('returns null for a value that is not a reading', () => {
    expect(bandFor(acwr, null)).toBeNull();
    expect(bandFor(acwr, Number.NaN)).toBeNull();
  });

  it('returns null for a metric with no ladder', () => {
    expect(bandFor(metricDescriptor('hrv')!, 45)).toBeNull();
  });
});

describe('relatedMetrics', () => {
  it('offers the rest of the family and never the metric itself', () => {
    const related = relatedMetrics('acwr');
    expect(related.length).toBeGreaterThan(0);
    expect(related.map((d) => d.id)).not.toContain('acwr');
    expect(related.every((d) => d.family === 'load')).toBe(true);
  });

  it('is empty for an unknown id rather than throwing', () => {
    expect(relatedMetrics('not-a-metric')).toEqual([]);
    expect(metricDescriptor('not-a-metric')).toBeNull();
  });
});
