import { describe, it, expect } from 'vitest';
import { interpolateBiomeState, easeOut } from '$lib/biome/interpolate';
import { BIOME_DEFAULTS, type BiomeState } from '$lib/biome/state';

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

describe('interpolateBiomeState', () => {
  const stateA: BiomeState = { ...BIOME_DEFAULTS, pulse: 60, recovery: 30 };
  const stateB: BiomeState = { ...BIOME_DEFAULTS, pulse: 80, recovery: 70 };

  it('returns start state at t=0', () => {
    const result = interpolateBiomeState(stateA, stateB, 0);
    expect(result.pulse).toBe(60);
    expect(result.recovery).toBe(30);
  });

  it('returns end state at t=1', () => {
    const result = interpolateBiomeState(stateA, stateB, 1);
    expect(result.pulse).toBe(80);
    expect(result.recovery).toBe(70);
  });

  it('interpolates numeric fields at t=0.5', () => {
    const result = interpolateBiomeState(stateA, stateB, 0.5);
    expect(result.pulse).toBe(70);
    expect(result.recovery).toBe(50);
  });

  it('snaps non-numeric fields to target', () => {
    const a = { ...BIOME_DEFAULTS, dayPhase: 'night' as const };
    const b = { ...BIOME_DEFAULTS, dayPhase: 'dawn' as const };
    const result = interpolateBiomeState(a, b, 0.1);
    expect(result.dayPhase).toBe('dawn');
  });
});
