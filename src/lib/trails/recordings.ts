// Field recordings -> activities.
//
// A recording made on the phone is the same kind of thing as a workout Apple
// sent: it gets a row in `activities` with source='recorded', so it appears on
// /health/activities alongside everything else rather than in a separate list nobody
// remembers to look at.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { activities, activitySeries, activityTracks } from '$lib/db/schema';
import { encodePolyline } from '$lib/health/polyline';
import {
  decimateTrack,
  elevationDelta,
  trackBounds,
  trackDistanceM,
  type TrackPoint,
} from './track';

export interface RecordingInput {
  /** Client-generated id so a retried upload does not duplicate the run. */
  clientId: string;
  name?: string;
  sport: string;
  startedAt: number; // unix seconds
  finishedAt: number;
  /** [lng, lat, ele|null, secondsFromStart] */
  track: TrackPoint[];
  /** [secondsFromStart, bpm] */
  heartRate?: [number, number][];
  /** Seconds of moving time, if the recorder tracked pauses. */
  movingS?: number | null;
  routeId?: string | null;
}

export interface RecordingResult {
  activityId: string;
  distanceM: number;
  pointCount: number;
}

const VALID_SPORTS = new Set(['run', 'trail_run', 'ride', 'mtb', 'hike', 'walk', 'other']);

export async function saveRecording(input: RecordingInput): Promise<RecordingResult> {
  if (!input.clientId) throw new Error('clientId is required');
  if (!Array.isArray(input.track) || input.track.length < 2) {
    throw new Error('a recording needs at least two track points');
  }
  if (!VALID_SPORTS.has(input.sport)) throw new Error(`unknown sport: ${input.sport}`);
  if (!Number.isFinite(input.startedAt) || !Number.isFinite(input.finishedAt)) {
    throw new Error('startedAt and finishedAt must be unix seconds');
  }
  if (input.finishedAt < input.startedAt) throw new Error('recording ends before it starts');

  // Same 3 m rule the Apple ingest uses: a phone sampling at 1 Hz spends a lot
  // of points standing still at a gate.
  const coordinates = decimateTrack(
    input.track.filter(
      ([lng, lat]) =>
        Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180,
    ),
    3,
  );
  if (coordinates.length < 2) throw new Error('no usable track points');

  const distanceM = trackDistanceM(coordinates);
  const { gainM, lossM } = elevationDelta(coordinates);
  const durationS = Math.max(0, Math.round(input.finishedAt - input.startedAt));
  const movingS = input.movingS && input.movingS > 0 ? Math.round(input.movingS) : durationS;

  const activityId = `recorded:${input.clientId}`;
  const startedAtIso = new Date(input.startedAt * 1000).toISOString();

  const row = {
    id: activityId,
    source: 'recorded',
    externalId: input.clientId,
    name: (input.name ?? '').trim() || 'Recorded activity',
    activityType: input.sport,
    rawType: null,
    startDate: Math.round(input.startedAt),
    endDate: Math.round(input.finishedAt),
    startDateLocal: startedAtIso,
    timezone: null,
    distanceM,
    durationS,
    activeDurationS: movingS,
    elevationGainM: gainM,
    elevationLossM: lossM,
    avgHeartrate: null as number | null,
    maxHeartrate: null as number | null,
    activeEnergyKj: null,
    totalEnergyKj: null,
    avgPaceSPerKm: distanceM > 0 ? (movingS / distanceM) * 1000 : null,
    avgCadence: null,
    hasTrack: true,
    metadata: input.routeId ? { routeId: input.routeId } : null,
  };

  const hr = (input.heartRate ?? []).filter(
    ([t, v]) => Number.isFinite(t) && Number.isFinite(v) && v > 0,
  );
  if (hr.length) {
    row.avgHeartrate = Math.round(hr.reduce((s, [, v]) => s + v, 0) / hr.length);
    row.maxHeartrate = Math.round(Math.max(...hr.map(([, v]) => v)));
  }

  await db
    .insert(activities)
    .values(row)
    .onConflictDoUpdate({ target: activities.id, set: { ...row, id: undefined } as never });

  await db.delete(activityTracks).where(eq(activityTracks.activityId, activityId));
  await db.insert(activityTracks).values({
    activityId,
    coordinates,
    pointCount: coordinates.length,
    bounds: trackBounds(coordinates),
    polyline: encodePolyline(coordinates.map(([lng, lat]) => [lat, lng] as [number, number])),
    distanceM,
  });

  await db.delete(activitySeries).where(eq(activitySeries.activityId, activityId));
  if (hr.length) {
    await db.insert(activitySeries).values({
      activityId,
      metric: 'heart_rate',
      units: 'bpm',
      sampleCount: hr.length,
      samples: hr,
    });
  }

  return { activityId, distanceM, pointCount: coordinates.length };
}
