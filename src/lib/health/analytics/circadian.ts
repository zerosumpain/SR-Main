// src/lib/health/analytics/circadian.ts
import type { MetricResult } from './types';
import type { SleepInterval } from './sri';

export type CircadianResult = {
  driftHours: number;        // positive = phase-delayed (sleeping later)
  baselineMidpointMin: number;
  recentMidpointMin: number;
  flag: 'aligned' | 'drift-late' | 'drift-early';
};

export function computeCircadianAlignment(intervals: SleepInterval[]): MetricResult<CircadianResult> {
  if (intervals.length < 14) {
    return {
      value: { driftHours: 0, baselineMidpointMin: 0, recentMidpointMin: 0, flag: 'aligned' },
      sufficiency: 'insufficient',
      asOf: new Date().toISOString(),
      sampleSize: intervals.length,
    };
  }
  const sorted = [...intervals].sort((a, b) => a.startLocalIso.localeCompare(b.startLocalIso));
  const recent = sorted.slice(-7);
  const baseline = sorted.slice(0, sorted.length - 7);

  const recentMid = avgMidpointMinutes(recent);
  const baseMid = avgMidpointMinutes(baseline);
  const driftHours = (recentMid - baseMid) / 60;

  return {
    value: {
      driftHours,
      baselineMidpointMin: baseMid,
      recentMidpointMin: recentMid,
      flag: Math.abs(driftHours) < 1 ? 'aligned' : driftHours > 0 ? 'drift-late' : 'drift-early',
    },
    sufficiency: sorted.length >= 28 ? 'ok' : 'partial',
    asOf: new Date().toISOString(),
    sampleSize: sorted.length,
  };
}

function avgMidpointMinutes(intervals: SleepInterval[]): number {
  if (intervals.length === 0) return 0;
  let sum = 0;
  for (const iv of intervals) {
    const start = new Date(iv.startLocalIso);
    const end = new Date(iv.endLocalIso);
    const midMs = (start.getTime() + end.getTime()) / 2;
    const mid = new Date(midMs);
    // Minutes since midnight UTC. Wrap negative values into 24h domain.
    const minOfDay = mid.getUTCHours() * 60 + mid.getUTCMinutes();
    sum += minOfDay;
  }
  return sum / intervals.length;
}
