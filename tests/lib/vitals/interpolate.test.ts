import { describe, it, expect } from 'vitest';
import { interpolateVitalsState, easeOut } from '$lib/vitals/interpolate';
import { VITALS_DEFAULTS, type VitalsState } from '$lib/vitals/state';

describe('easeOut', () => {
  it('returns 0 at t=0', () => {
    expect(easeOut(0)).toBeCloseTo(0, 2);
  });

  it('returns 1 at t=1', () => {
    expect(easeOut(1)).toBeCloseTo(1, 2);
  });

  it('is mostly done by t=0.5', () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.7);
  });
});

describe('interpolateVitalsState', () => {
  const stateA: VitalsState = { ...VITALS_DEFAULTS, pulse: 60, recovery: 30 };
  const stateB: VitalsState = { ...VITALS_DEFAULTS, pulse: 80, recovery: 70 };

  it('returns start state at t=0', () => {
    const result = interpolateVitalsState(stateA, stateB, 0);
    expect(result.pulse).toBe(60);
    expect(result.recovery).toBe(30);
  });

  it('returns end state at t=1', () => {
    const result = interpolateVitalsState(stateA, stateB, 1);
    expect(result.pulse).toBe(80);
    expect(result.recovery).toBe(70);
  });

  it('interpolates numeric fields at t=0.5', () => {
    const result = interpolateVitalsState(stateA, stateB, 0.5);
    expect(result.pulse).toBe(70);
    expect(result.recovery).toBe(50);
  });

  it('snaps non-numeric fields to target', () => {
    const a = { ...VITALS_DEFAULTS, dayPhase: 'night' as const };
    const b = { ...VITALS_DEFAULTS, dayPhase: 'dawn' as const };
    const result = interpolateVitalsState(a, b, 0.1);
    expect(result.dayPhase).toBe('dawn');
  });
});
