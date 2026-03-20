import { db } from '$lib/db';
import { stravaActivities, whoopRecovery, whoopSleep } from '$lib/db/schema';
import { gte, desc } from 'drizzle-orm';
import type { StatsResponse } from './types';

export async function getStats(): Promise<StatsResponse> {
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;

  const [activities, recoveries, sleeps] = await Promise.all([
    db.select().from(stravaActivities).where(gte(stravaActivities.startDate, sevenDaysAgo)),
    db.select().from(whoopRecovery).where(gte(whoopRecovery.createdDate, sevenDaysAgo)),
    db.select().from(whoopSleep).where(gte(whoopSleep.startDate, sevenDaysAgo)),
  ]);

  const weekly = {
    activities: activities.length,
    totalDistance: activities.reduce((sum, a) => sum + (a.distance || 0), 0),
    totalDuration: activities.reduce((sum, a) => sum + (a.movingTime || 0), 0),
    totalElevation: activities.reduce((sum, a) => sum + (a.totalElevationGain || 0), 0),
    avgRecovery: recoveries.length ? Math.round(recoveries.reduce((sum, r) => sum + (r.recoveryScore || 0), 0) / recoveries.length) : 0,
    avgSleep: sleeps.length ? Math.round(sleeps.reduce((sum, s) => sum + (s.sleepPerformance || 0), 0) / sleeps.length) : 0,
  };

  // Personal records — query all time
  const allActivities = await db.select().from(stravaActivities).orderBy(desc(stravaActivities.startDate));
  const personalRecords = [];

  const longestRun = allActivities.filter(a => a.type === 'Run').sort((a, b) => (b.distance || 0) - (a.distance || 0))[0];
  if (longestRun) personalRecords.push({ label: 'Longest Run', value: Math.round((longestRun.distance || 0) / 1000 * 10) / 10, unit: 'km', date: new Date((longestRun.startDate || 0) * 1000).toISOString().slice(0, 10) });

  const fastestRun = allActivities.filter(a => a.type === 'Run' && (a.distance || 0) >= 5000).sort((a, b) => ((a.movingTime || Infinity) / (a.distance || 1)) - ((b.movingTime || Infinity) / (b.distance || 1)))[0];
  if (fastestRun) personalRecords.push({ label: 'Fastest Pace', value: Math.round(((fastestRun.movingTime || 0) / 60) / ((fastestRun.distance || 1) / 1000) * 100) / 100, unit: 'min/km', date: new Date((fastestRun.startDate || 0) * 1000).toISOString().slice(0, 10) });

  const highestElevation = allActivities.sort((a, b) => (b.totalElevationGain || 0) - (a.totalElevationGain || 0))[0];
  if (highestElevation) personalRecords.push({ label: 'Most Elevation', value: Math.round(highestElevation.totalElevationGain || 0), unit: 'm', date: new Date((highestElevation.startDate || 0) * 1000).toISOString().slice(0, 10) });

  return { weekly, personalRecords };
}
