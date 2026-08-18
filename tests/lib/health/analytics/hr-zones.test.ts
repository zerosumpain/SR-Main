// tests/lib/health/analytics/hr-zones.test.ts
import { describe, it, expect } from 'vitest';
import {
  timeInZones,
  zoneOf,
  zoneEdges,
  addZones,
  totalZoneSeconds,
} from '$lib/health/analytics/hr-zones';

describe('zoneOf', () => {
  it('assigns ACSM %HRmax bands', () => {
    expect(zoneOf(80, 200)).toBe('z0'); // 40%
    expect(zoneOf(110, 200)).toBe('z1'); // 55%
    expect(zoneOf(130, 200)).toBe('z2'); // 65%
    expect(zoneOf(150, 200)).toBe('z3'); // 75%
    expect(zoneOf(170, 200)).toBe('z4'); // 85%
    expect(zoneOf(190, 200)).toBe('z5'); // 95%
  });
});

describe('zoneEdges', () => {
  it('returns absolute bpm starts for z1..z5', () => {
    expect(zoneEdges(200)).toEqual([100, 120, 140, 160, 180]);
  });
});

describe('timeInZones', () => {
  it('accounts every sampled second into exactly one zone', () => {
    const samples: [number, number][] = Array.from({ length: 121 }, (_, i) => [
      i * 10,
      i < 60 ? 130 : 170, // 10 min z2 then 10 min z4 (hrMax 200)
    ]);
    const z = timeInZones(samples, 200)!;
    expect(z.z2).toBe(600);
    expect(z.z4).toBe(600);
    expect(totalZoneSeconds(z)).toBe(1200);
  });

  it('returns null without a usable series', () => {
    expect(timeInZones([], 200)).toBeNull();
    expect(timeInZones([[0, 120]], 0)).toBeNull();
  });
});

describe('addZones', () => {
  it('sums componentwise', () => {
    const a = { z0: 1, z1: 2, z2: 3, z3: 4, z4: 5, z5: 6 };
    const b = { z0: 10, z1: 20, z2: 30, z3: 40, z4: 50, z5: 60 };
    expect(addZones(a, b)).toEqual({ z0: 11, z1: 22, z2: 33, z3: 44, z4: 55, z5: 66 });
  });
});
