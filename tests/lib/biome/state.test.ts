import { describe, it, expect } from 'vitest';
import {
  BIOME_DEFAULTS,
  roundPulse,
  normalizeStrain,
  clamp100,
  isStale,
  cardiacPulse,
  windToVector,
  type BiomeState,
  type WeatherCondition,
  type RenderTier,
} from '$lib/biome/state';

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

describe('cardiacPulse', () => {
  it('returns 0-1 range', () => {
    const val = cardiacPulse(0.5, 72, 50);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(1);
  });

  it('returns 0 for very low BPM at specific time', () => {
    const peak = cardiacPulse(0, 60, 50);
    expect(peak).toBeGreaterThan(0);
  });
});

describe('windToVector', () => {
  it('converts north wind to southward drift', () => {
    const [x, y] = windToVector(0, 10);
    expect(x).toBeCloseTo(0, 1);
    expect(y).toBeLessThan(0);
  });

  it('converts east wind to westward drift', () => {
    const [x, y] = windToVector(90, 10);
    expect(x).toBeLessThan(0);
    expect(y).toBeCloseTo(0, 1);
  });
});

describe('BIOME_DEFAULTS', () => {
  it('has valid default state', () => {
    expect(BIOME_DEFAULTS.pulse).toBe(60);
    expect(BIOME_DEFAULTS.recovery).toBe(50);
    expect(BIOME_DEFAULTS.stale).toBe(true);
    expect(BIOME_DEFAULTS.sources.heartRate).toBe(false);
  });
});
