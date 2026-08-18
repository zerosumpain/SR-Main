import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { appleHealthMetrics } from '$lib/db/schema';
import { and, eq, gte, lte } from 'drizzle-orm';
import { ingestWorkouts } from '$lib/trails/ingest';
import {
  normaliseActivityType,
  OUTDOOR_TYPES,
  routePointCoords,
  type HaeWorkout,
} from '$lib/trails/hae-workouts';
import type { RequestHandler } from './$types';

const SUPPORTED_METRICS = [
  'heart_rate',
  'heart_rate_variability',
  'resting_heart_rate',
  'oxygen_saturation',
  'respiratory_rate',
  'body_temperature',
  'step_count',
  'walking_running_distance',
  'flights_climbed',
  'active_energy',
  'body_mass',
  'apple_exercise_time',
  'apple_stand_hour',
  'vo2_max',
];

interface AppleHealthDataPoint {
  date: string; // ISO 8601
  qty?: number;
  Avg?: number;
  Min?: number;
  Max?: number;
}

interface AppleHealthMetric {
  name: string;
  units: string;
  data: AppleHealthDataPoint[];
}

export const POST: RequestHandler = async ({ request }) => {
  // Auth check
  const apiKey = request.headers.get('x-api-key');
  if (!env.APPLE_HEALTH_API_KEY || apiKey !== env.APPLE_HEALTH_API_KEY) {
    throw error(401, 'Invalid API key');
  }

  const start = Date.now();
  const payload = await request.json();
  const metrics: AppleHealthMetric[] = payload?.data?.metrics || [];
  const workouts: HaeWorkout[] = Array.isArray(payload?.data?.workouts)
    ? payload.data.workouts
    : [];

  console.log(
    `[apple-ingest] received ${metrics.length} metric(s): ` +
      (metrics.map((m) => `${m.name}[${m.data?.length ?? 0}]`).join(', ') || '(none)'),
  );

  let totalSynced = 0;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const metric of metrics) {
    if (!SUPPORTED_METRICS.includes(metric.name)) {
      console.log(`[apple-ingest] skipped unsupported metric: ${metric.name}`);
      continue;
    }
    if (!metric.data?.length) continue;

    try {
      const mapped = metric.data
        .map((dp) => {
          const value = dp.qty ?? dp.Avg;
          if (value == null) return null;
          const dateUnix = Math.floor(new Date(dp.date).getTime() / 1000);
          return {
            metricName: metric.name,
            date: dateUnix,
            dateLocal: dp.date,
            value: Math.round(value * 100),
            minValue: dp.Min != null ? Math.round(dp.Min * 100) : null,
            maxValue: dp.Max != null ? Math.round(dp.Max * 100) : null,
            units: metric.units,
            // syncedAt omitted — DB default (extract(epoch from now())::integer) handles it
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (!mapped.length) {
        console.log(
          `[apple-ingest] ${metric.name}: ${metric.data.length} point(s) but 0 usable values`,
        );
        continue;
      }

      // Delete stale data in date range for this metric
      const dates = mapped.map((m) => m.date);
      const minDate = Math.min(...dates);
      const maxDate = Math.max(...dates);

      await db.delete(appleHealthMetrics).where(
        and(
          eq(appleHealthMetrics.metricName, metric.name),
          gte(appleHealthMetrics.date, minDate),
          lte(appleHealthMetrics.date, maxDate),
        ),
      );

      // Batch insert (500 at a time)
      for (let i = 0; i < mapped.length; i += 500) {
        const batch = mapped.slice(i, i + 500);
        await db.insert(appleHealthMetrics).values(batch);
      }

      totalSynced += mapped.length;
    } catch (e) {
      errors.push(`${metric.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Workouts — the /trails half. Independent of the metrics loop above: a
  // failure in either must not cost the other its batch.
  let workoutResult = { workoutsSynced: 0, tracksSynced: 0, seriesSynced: 0, skipped: 0 };
  if (workouts.length) {
    console.log(`[apple-ingest] received ${workouts.length} workout(s)`);
    const ingested = await ingestWorkouts(workouts);
    errors.push(...ingested.errors);
    workoutResult = {
      workoutsSynced: ingested.workoutsSynced,
      tracksSynced: ingested.tracksSynced,
      seriesSynced: ingested.seriesSynced,
      skipped: ingested.skipped,
    };
    console.log(
      `[apple-ingest] workouts — ${ingested.workoutsSynced} synced, ` +
        `${ingested.tracksSynced} track(s), ${ingested.seriesSynced} series`,
    );

    // An outdoor workout with no usable GPS trace means either the payload
    // carried no route (HAE toggle off, or the request was rejected upstream
    // for size) or the route arrived in a shape the mapper rejects — the v2
    // key-name change slipped through here once, invisibly, because `route`
    // is a modelled key and unusable points leave no trace in metadata. So
    // when points exist but fail, name the keys of the first one. Warn — in
    // the log and in the response so HAE's activity log shows it — but do not
    // fail the sync: the workout itself landed, and HAE retries failed
    // batches indefinitely.
    for (const w of workouts) {
      if (!w || typeof w !== 'object') continue;
      const type = normaliseActivityType(typeof w.name === 'string' ? w.name : null);
      if (!OUTDOOR_TYPES.has(type)) continue;
      const route = Array.isArray(w.route) ? w.route : [];
      const usable = route.filter((p) => routePointCoords(p) !== null).length;
      if (usable >= 2) continue;
      const detail = route.length
        ? `route has ${route.length} point(s) but ${usable} usable; first point keys: ${Object.keys(route[0] ?? {}).join(',')}`
        : 'no route data in payload';
      warnings.push(`${w.name ?? 'workout'} (${w.start ?? 'no date'}): outdoor workout without a usable GPS trace — ${detail}`);
    }
    if (warnings.length) {
      console.log(`[apple-ingest] warnings: ${warnings.join('; ')}`);
    }
  }

  console.log(
    `[apple-ingest] done — ${totalSynced} record(s) synced` +
      (errors.length ? `, errors: ${errors.join('; ')}` : ''),
  );

  return json({
    success: errors.length === 0,
    recordsSynced: totalSynced,
    ...workoutResult,
    errors: errors.length ? errors : undefined,
    warnings: warnings.length ? warnings : undefined,
    duration: Date.now() - start,
  });
};

// GET — health check
export const GET: RequestHandler = async () => {
  return json({
    status: env.APPLE_HEALTH_API_KEY ? 'ready' : 'not_configured',
    endpoint: '/api/health/apple/ingest',
    auth: 'X-API-Key header required',
  });
};
