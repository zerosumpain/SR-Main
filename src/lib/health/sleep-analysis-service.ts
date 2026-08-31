import { db } from '$lib/db';
import { whoopSleep } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import type { SleepAnalysis } from './types';

export async function getSleepAnalysis(): Promise<SleepAnalysis> {
  // Query last 14 non-nap sleep records, ordered by startDate desc
  const sleeps = await db.select().from(whoopSleep)
    .where(eq(whoopSleep.nap, false))
    .orderBy(desc(whoopSleep.startDate))
    .limit(14);

  if (!sleeps.length) {
    return {
      latest: null,
      trend: [],
    };
  }

  const latest = sleeps[0];
  const totalSleep = (latest.totalLight || 0) + (latest.totalSlowWave || 0) + (latest.totalRem || 0);
  const totalInBed = latest.totalInBed || 1;

  return {
    latest: {
      // A night belongs to the morning on which it ended. Exposing both the day
      // and instant prevents callers from calling an old row "last night".
      date: new Date(latest.endDate * 1000).toISOString().slice(0, 10),
      endedAt: new Date(latest.endDate * 1000).toISOString(),
      totalDuration: totalInBed,
      lightPercent: Math.round((latest.totalLight || 0) / totalSleep * 100),
      deepPercent: Math.round((latest.totalSlowWave || 0) / totalSleep * 100),
      remPercent: Math.round((latest.totalRem || 0) / totalSleep * 100),
      awakePercent: Math.round((latest.totalAwake || 0) / totalInBed * 100),
      performance: latest.sleepPerformance || 0,
      consistency: latest.sleepConsistency || 0,
      efficiency: latest.sleepEfficiency || 0,
    },
    trend: sleeps.reverse().map(s => ({
      date: new Date((s.startDate || 0) * 1000).toISOString().slice(0, 10),
      duration: s.totalInBed || 0,
      performance: s.sleepPerformance || 0,
    })),
  };
}
