import { describe, it, expect } from 'vitest';
import {
  VITALS_DEFAULTS,
  roundPulse,
  normalizeStrain,
  clamp100,
  isStale,
  type VitalsState,
  type WeatherCondition,
} from '$lib/vitals/state';

describe('roundPulse', () => {
  it('rounds to nearest 5', () => {
    expect(roundPulse(72)).toBe(70);
    expect(roundPulse(73)).toBe(75);
    expect(roundPulse(60)).toBe(60);
  });
});

describe('normalizeStrain', () => {
  it('normalizes 0-21 scale to 0-100', () => {
    expect(normalizeStrain(0)).toBe(0);
    expect(normalizeStrain(21)).toBe(100);
    expect(normalizeStrain(10.5)).toBe(50);
  });

  it('clamps out-of-range values', () => {
    expect(normalizeStrain(-1)).toBe(0);
    expect(normalizeStrain(25)).toBe(100);
  });
});

describe('clamp100', () => {
  it('clamps to 0-100', () => {
    expect(clamp100(50)).toBe(50);
    expect(clamp100(-10)).toBe(0);
    expect(clamp100(200)).toBe(100);
  });
});

describe('isStale', () => {
  it('returns true if dataAge > 21600', () => {
    expect(isStale(21601)).toBe(true);
    expect(isStale(21600)).toBe(false);
    expect(isStale(0)).toBe(false);
  });
});


describe('VITALS_DEFAULTS', () => {
  it('has valid default state', () => {
    expect(VITALS_DEFAULTS.pulse).toBe(60);
    expect(VITALS_DEFAULTS.recovery).toBe(50);
    expect(VITALS_DEFAULTS.stale).toBe(true);
    expect(VITALS_DEFAULTS.sources.heartRate).toBe(false);
  });
});
