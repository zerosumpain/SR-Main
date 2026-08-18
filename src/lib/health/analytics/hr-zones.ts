// src/lib/health/analytics/hr-zones.ts
// Time-in-zone from a heart-rate series, anchored on %HRmax (ACSM bands).
// Z1 50–60%, Z2 60–70%, Z3 70–80%, Z4 80–90%, Z5 90%+; below 50% is Z0
// (rest/idle) so the zone rows always sum to the sampled duration.

import { eachInterval, type HrSample } from './series-intervals';

export interface ZoneSeconds {
  z0: number;
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
}

export const ZONE_BOUNDS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

export function zoneOf(hr: number, hrMax: number): keyof ZoneSeconds {
  if (hrMax <= 0) return 'z0';
  const f = hr / hrMax;
  if (f < ZONE_BOUNDS[0]) return 'z0';
  if (f < ZONE_BOUNDS[1]) return 'z1';
  if (f < ZONE_BOUNDS[2]) return 'z2';
  if (f < ZONE_BOUNDS[3]) return 'z3';
  if (f < ZONE_BOUNDS[4]) return 'z4';
  return 'z5';
}

/** Absolute bpm edges for display: [z1start, z2start, z3start, z4start, z5start]. */
export function zoneEdges(hrMax: number): number[] {
  return ZONE_BOUNDS.map((f) => Math.round(f * hrMax));
}

export function timeInZones(samples: HrSample[], hrMax: number): ZoneSeconds | null {
  if (hrMax <= 0) return null;
  const zones: ZoneSeconds = { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };
  const ok = eachInterval(samples, (dt, hr) => {
    zones[zoneOf(hr, hrMax)] += dt;
  });
  return ok ? zones : null;
}

export function addZones(a: ZoneSeconds, b: ZoneSeconds): ZoneSeconds {
  return {
    z0: a.z0 + b.z0,
    z1: a.z1 + b.z1,
    z2: a.z2 + b.z2,
    z3: a.z3 + b.z3,
    z4: a.z4 + b.z4,
    z5: a.z5 + b.z5,
  };
}

export function totalZoneSeconds(z: ZoneSeconds): number {
  return z.z0 + z.z1 + z.z2 + z.z3 + z.z4 + z.z5;
}
