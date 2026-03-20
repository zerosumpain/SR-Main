import { db } from '$lib/db';
import { stravaActivities, whoopWorkouts, whoopSleep, whoopRecovery } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import type { TimelineEvent } from './types';

export async function getTimeline(page = 1, limit = 20): Promise<{ events: TimelineEvent[]; hasMore: boolean }> {
  // Fetch recent records from each source
  const fetchLimit = limit * 2; // over-fetch to merge and paginate

  const [activities, workouts, sleeps, recoveries] = await Promise.all([
    db.select().from(stravaActivities).orderBy(desc(stravaActivities.startDate)).limit(fetchLimit),
    db.select().from(whoopWorkouts).orderBy(desc(whoopWorkouts.startDate)).limit(fetchLimit),
    db.select().from(whoopSleep).orderBy(desc(whoopSleep.startDate)).limit(fetchLimit),
    db.select().from(whoopRecovery).orderBy(desc(whoopRecovery.createdDate)).limit(fetchLimit),
  ]);

  const events: TimelineEvent[] = [];

  for (const a of activities) {
    events.push({
      id: `strava-${a.id}`,
      type: 'strava_activity',
      date: new Date((a.startDate || 0) * 1000).toISOString(),
      title: a.name || a.type || 'Activity',
      summary: {
        type: a.type || '',
        distance: `${((a.distance || 0) / 1000).toFixed(1)} km`,
        duration: `${Math.round((a.movingTime || 0) / 60)} min`,
        ...(a.averageHeartrate ? { hr: `${Math.round(a.averageHeartrate)} bpm` } : {}),
      },
    });
  }

  for (const w of workouts) {
    events.push({
      id: `whoop-workout-${w.id}`,
      type: 'whoop_workout',
      date: new Date((w.startDate || 0) * 1000).toISOString(),
      title: w.sportName || 'Workout',
      summary: {
        strain: (w.strain || 0).toFixed(1),
        hr: `${w.averageHeartrate || 0} bpm`,
        kj: `${Math.round(w.kilojoule || 0)} kJ`,
      },
    });
  }

  for (const s of sleeps) {
    const hours = ((s.totalInBed || 0) / 3600000).toFixed(1);
    events.push({
      id: `whoop-sleep-${s.id}`,
      type: 'whoop_sleep',
      date: new Date((s.startDate || 0) * 1000).toISOString(),
      title: s.nap ? 'Nap' : 'Sleep',
      summary: {
        duration: `${hours} hrs`,
        performance: `${Math.round(s.sleepPerformance || 0)}%`,
        efficiency: `${Math.round(s.sleepEfficiency || 0)}%`,
      },
    });
  }

  for (const r of recoveries) {
    events.push({
      id: `whoop-recovery-${r.cycleId}`,
      type: 'whoop_recovery',
      date: new Date((r.createdDate || 0) * 1000).toISOString(),
      title: 'Recovery',
      summary: {
        score: `${Math.round(r.recoveryScore || 0)}%`,
        hrv: `${(r.hrvRmssd || 0).toFixed(1)} ms`,
        rhr: `${Math.round(r.restingHeartRate || 0)} bpm`,
      },
    });
  }

  // Sort by date descending, paginate
  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const start = (page - 1) * limit;
  const paged = events.slice(start, start + limit);

  return { events: paged, hasMore: start + limit < events.length };
}
