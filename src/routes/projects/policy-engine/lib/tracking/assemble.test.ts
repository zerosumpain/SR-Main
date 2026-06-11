import { describe, it, expect } from 'vitest';
import { assembleSnapshot } from './assemble';
import { buildProjectionSims, projectedValue } from './projection';
import { INDICATORS_BY_KEY } from './registry';

const sims = buildProjectionSims();

describe('assembleSnapshot', () => {
  it('pairs an observed value with both projections and both statuses', () => {
    const spec = INDICATORS_BY_KEY['attainment8'];
    const baseProj = projectedValue(spec, sims.baseSim, 2030)!;
    const observed = baseProj - 5; // clearly below the status-quo path
    const snap = assembleSnapshot({
      spec, observedValue: observed, refYear: 2030, refPeriodLabel: '2029/30',
      releaseDate: '2030-10-01T00:00:00Z', releaseHash: 'h1', live: true, sims,
    });
    expect(snap.indicatorKey).toBe('attainment8');
    expect(snap.unit).toBe('score');
    expect(snap.observedValue).toBe(observed);
    expect(snap.projectedBaseline).toBeCloseTo(baseProj, 3);
    expect(snap.projectedPolicy).toBeCloseTo(projectedValue(spec, sims.policySim, 2030)!, 3);
    // 5 points below the baseline path (>3% of ~46) → off-track vs baseline
    expect(snap.statusVsBaseline).toBe('off-track');
    expect(snap.source).toContain('DfE EES');
    expect(snap.live).toBe(true);
  });

  it('marks an observed-only indicator (no projection) as no-data status', () => {
    const spec = INDICATORS_BY_KEY['gdpPerCapitaUK'];
    const snap = assembleSnapshot({
      spec, observedValue: 59911, refYear: 2023, refPeriodLabel: '2023',
      releaseDate: null, releaseHash: null, live: true, sims,
    });
    expect(snap.projectedBaseline).toBeNull();
    expect(snap.projectedPolicy).toBeNull();
    expect(snap.statusVsBaseline).toBe('no-data');
    expect(snap.statusVsPolicy).toBe('no-data');
    expect(snap.observedValue).toBe(59911);
  });

  it('marks a missing observation as no-data even when projections exist', () => {
    const spec = INDICATORS_BY_KEY['persistentAbsenceDis'];
    const snap = assembleSnapshot({
      spec, observedValue: null, refYear: 2030, refPeriodLabel: '2029/30',
      releaseDate: null, releaseHash: null, live: false, sims,
    });
    expect(snap.observedValue).toBeNull();
    expect(snap.statusVsBaseline).toBe('no-data');
    expect(snap.projectedBaseline).not.toBeNull(); // projection still recorded for the chart
  });
});
