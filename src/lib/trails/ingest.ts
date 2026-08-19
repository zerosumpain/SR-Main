// Persistence for mapped Health Auto Export workouts.
//
// Separated from the mapper so the mapping contract stays testable without a
// database, and from the endpoint so the same path can be reused by a future
// backfill upload without duplicating the upsert rules.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { activities, activitySeries, activityTracks } from '$lib/db/schema';
import { mapWorkout, type HaeWorkout } from './hae-workouts';
import { scheduleSegmentRebuild } from './segments-service';

export interface IngestResult {
  workoutsSynced: number;
  tracksSynced: number;
  seriesSynced: number;
  skipped: number;
  errors: string[];
}

/**
 * Upsert one mapped workout and its children.
 *
 * Children are replaced rather than merged: a re-export of the same workout is
 * the authoritative version of it, and a partial merge would leave samples
 * from a superseded export interleaved with the new ones.
 */
async function persistWorkout(workout: HaeWorkout): Promise<{ track: number; series: number }> {
  const { activity, track, series } = mapWorkout(workout);

  await db
    .insert(activities)
    .values(activity)
    .onConflictDoUpdate({
      target: activities.id,
      set: {
        name: activity.name,
        activityType: activity.activityType,
        rawType: activity.rawType,
        startDate: activity.startDate,
        endDate: activity.endDate,
        startDateLocal: activity.startDateLocal,
        timezone: activity.timezone,
        distanceM: activity.distanceM,
        durationS: activity.durationS,
        activeDurationS: activity.activeDurationS,
        elevationGainM: activity.elevationGainM,
        elevationLossM: activity.elevationLossM,
        avgHeartrate: activity.avgHeartrate,
        maxHeartrate: activity.maxHeartrate,
        activeEnergyKj: activity.activeEnergyKj,
        totalEnergyKj: activity.totalEnergyKj,
        avgPaceSPerKm: activity.avgPaceSPerKm,
        avgCadence: activity.avgCadence,
        hasTrack: activity.hasTrack,
        metadata: activity.metadata,
      },
    });

  await db.delete(activityTracks).where(eq(activityTracks.activityId, activity.id));
  if (track) {
    await db.insert(activityTracks).values({
      activityId: activity.id,
      coordinates: track.coordinates,
      pointCount: track.pointCount,
      bounds: track.bounds,
      polyline: track.polyline,
      distanceM: track.distanceM,
    });
  }

  await db.delete(activitySeries).where(eq(activitySeries.activityId, activity.id));
  if (series.length) {
    await db.insert(activitySeries).values(
      series.map((s) => ({
        activityId: activity.id,
        metric: s.metric,
        units: s.units,
        sampleCount: s.sampleCount,
        samples: s.samples,
      })),
    );
  }

  return { track: track ? 1 : 0, series: series.length };
}

/**
 * Ingest a batch of HAE workouts.
 *
 * Each workout is isolated: one malformed entry is recorded in `errors` and the
 * rest of the batch still lands. This mirrors the per-metric loop that already
 * guards the daily-metrics half of the same endpoint — the phone retries whole
 * batches, so letting one bad workout reject the request would stall every
 * good workout behind it indefinitely.
 */
export async function ingestWorkouts(workouts: HaeWorkout[]): Promise<IngestResult> {
  const result: IngestResult = {
    workoutsSynced: 0,
    tracksSynced: 0,
    seriesSynced: 0,
    skipped: 0,
    errors: [],
  };

  for (const workout of workouts) {
    if (!workout || typeof workout !== 'object') {
      result.skipped++;
      continue;
    }
    try {
      const { track, series } = await persistWorkout(workout);
      result.workoutsSynced++;
      result.tracksSynced += track;
      result.seriesSynced += series;
    } catch (e) {
      const label = workout.name ?? workout.id ?? 'unnamed workout';
      result.errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // New ground may repeat old ground. Deliberately not awaited: the phone is
  // already holding a large upload open, and a segment rebuild is worth a few
  // seconds of background work but not a few seconds of the handset's time.
  if (result.tracksSynced > 0) scheduleSegmentRebuild();

  return result;
}
