/**
 * Health Dashboard Sync Service
 *
 * Orchestrates fetching data from Strava and Whoop APIs and upserting into the database.
 * Supports incremental sync (default) and full backfill for historical data.
 */

import { db } from '$lib/db';
import {
  stravaActivities,
  whoopWorkouts,
  whoopSleep,
  whoopRecovery,
  whoopCycles,
  healthSyncState,
} from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getValidToken } from './tokens';
import { getStravaActivities } from './strava';
import { getWhoopWorkouts, getWhoopSleeps, getWhoopRecoveries, getWhoopCycles } from './whoop';
import type { SyncOptions, SyncResult, SyncResponse } from './types';

// ==========================================
// Sync State Management
// ==========================================

async function updateSyncState(
  service: string,
  status: string,
  recordsSynced?: number,
  errorMessage?: string
) {
  const now = Math.floor(Date.now() / 1000);

  try {
    const existing = await db
      .select()
      .from(healthSyncState)
      .where(eq(healthSyncState.service, service))
      .limit(1);

    if (existing.length) {
      await db
        .update(healthSyncState)
        .set({
          status,
          lastSyncAt: now,
          ...(status === 'success' ? { lastSuccessfulSyncAt: now } : {}),
          recordsSynced: recordsSynced ?? null,
          errorMessage: errorMessage ?? null,
        })
        .where(eq(healthSyncState.service, service));
    } else {
      await db.insert(healthSyncState).values({
        service,
        status,
        lastSyncAt: now,
        lastSuccessfulSyncAt: status === 'success' ? now : null,
        recordsSynced: recordsSynced ?? null,
        errorMessage: errorMessage ?? null,
      });
    }
  } catch (error) {
    console.error(`Failed to update sync state for ${service}:`, error);
  }
}

// ==========================================
// Sport ID mapping (Whoop)
// ==========================================

function getSportName(sportId: number): string {
  const sportNames: Record<number, string> = {
    0: 'Running',
    1: 'Cycling',
    33: 'CrossFit',
    34: 'HIIT',
    44: 'Functional Fitness',
    48: 'Weightlifting',
    52: 'Walking',
    63: 'Swimming',
    71: 'Yoga',
  };
  return sportNames[sportId] || 'Other';
}

// ==========================================
// Strava Sync
// ==========================================

export async function syncStravaActivities(options: SyncOptions = {}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let recordsSynced = 0;

  try {
    const accessToken = await getValidToken('strava');
    if (!accessToken) {
      return {
        success: false,
        recordsSynced: 0,
        errors: ['No Strava access token available'],
        duration: Date.now() - startTime,
      };
    }

    await updateSyncState('strava', 'syncing');

    const maxPages = options.fullBackfill ? (options.maxPages ?? 20) : 1;
    const perPage = 50;

    for (let page = 1; page <= maxPages; page++) {
      try {
        const activities = await getStravaActivities(accessToken, page, perPage);

        if (activities.length === 0) break;

        for (const activity of activities) {
          try {
            const mapped = {
              id: activity.id,
              name: activity.name,
              type: activity.type,
              sportType: activity.sport_type,
              startDate: Math.floor(new Date(activity.start_date).getTime() / 1000),
              startDateLocal: activity.start_date_local,
              timezone: activity.timezone,
              distance: Math.round(activity.distance),
              movingTime: activity.moving_time,
              elapsedTime: activity.elapsed_time,
              totalElevationGain: Math.round(activity.total_elevation_gain),
              averageSpeed: Math.round(activity.average_speed * 100),
              maxSpeed: Math.round(activity.max_speed * 100),
              averageHeartrate: activity.average_heartrate
                ? Math.round(activity.average_heartrate)
                : null,
              maxHeartrate: activity.max_heartrate ? Math.round(activity.max_heartrate) : null,
              calories: activity.calories ?? null,
              sufferScore: activity.suffer_score ?? null,
              mapData: activity.map ? JSON.stringify(activity.map) : null,
              startLatLng: activity.start_latlng ? JSON.stringify(activity.start_latlng) : null,
              endLatLng: activity.end_latlng ? JSON.stringify(activity.end_latlng) : null,
              syncedAt: Math.floor(Date.now() / 1000),
            };

            await db
              .insert(stravaActivities)
              .values(mapped)
              .onConflictDoUpdate({
                target: stravaActivities.id,
                set: {
                  name: mapped.name,
                  type: mapped.type,
                  sportType: mapped.sportType,
                  startDate: mapped.startDate,
                  startDateLocal: mapped.startDateLocal,
                  timezone: mapped.timezone,
                  distance: mapped.distance,
                  movingTime: mapped.movingTime,
                  elapsedTime: mapped.elapsedTime,
                  totalElevationGain: mapped.totalElevationGain,
                  averageSpeed: mapped.averageSpeed,
                  maxSpeed: mapped.maxSpeed,
                  averageHeartrate: mapped.averageHeartrate,
                  maxHeartrate: mapped.maxHeartrate,
                  calories: mapped.calories,
                  sufferScore: mapped.sufferScore,
                  mapData: mapped.mapData,
                  startLatLng: mapped.startLatLng,
                  endLatLng: mapped.endLatLng,
                  syncedAt: mapped.syncedAt,
                },
              });

            recordsSynced++;
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            errors.push(`Failed to sync activity ${activity.id}: ${msg}`);
          }
        }

        if (activities.length < perPage) break;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to fetch page ${page}: ${msg}`);
        break;
      }
    }

    const success = errors.length === 0;
    await updateSyncState('strava', success ? 'success' : 'error', recordsSynced, errors.join('; '));

    if (success) {
      try {
        const { emit } = await import('$lib/workflows/event-bus');
        emit('strava_activity_synced', { recordsSynced, syncedAt: new Date().toISOString() });
      } catch {
        // event-bus not critical path
      }
    }

    return {
      success,
      recordsSynced,
      errors,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(errorMessage);
    await updateSyncState('strava', 'error', 0, errorMessage);

    return {
      success: false,
      recordsSynced: 0,
      errors,
      duration: Date.now() - startTime,
    };
  }
}

// ==========================================
// Whoop Sync
// ==========================================

export async function syncWhoopWorkouts(options: SyncOptions = {}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let recordsSynced = 0;

  try {
    const accessToken = await getValidToken('whoop');
    if (!accessToken) {
      return {
        success: false,
        recordsSynced: 0,
        errors: ['No Whoop access token available'],
        duration: Date.now() - startTime,
      };
    }

    const limit = options.fullBackfill ? 100 : 20;
    const workouts = await getWhoopWorkouts(accessToken, { limit });

    for (const workout of workouts) {
      if (workout.score_state !== 'SCORED') continue;

      try {
        const zoneDuration = workout.score?.zone_duration;
        const mapped = {
          id: String(workout.id),
          userId: workout.user_id,
          startDate: Math.floor(new Date(workout.start).getTime() / 1000),
          endDate: Math.floor(new Date(workout.end).getTime() / 1000),
          startDateLocal: workout.start,
          timezone: workout.timezone_offset,
          sportId: workout.sport_id,
          sportName: getSportName(workout.sport_id),
          strain: workout.score?.strain ?? 0,
          averageHeartrate: workout.score?.average_heart_rate ?? 0,
          maxHeartrate: workout.score?.max_heart_rate ?? 0,
          kilojoule: workout.score?.kilojoule ?? 0,
          distanceMeters: workout.score?.distance_meter ?? null,
          altitudeGainMeters: workout.score?.altitude_gain_meter ?? null,
          zoneZero: zoneDuration?.zone_zero_milli ?? 0,
          zoneOne: zoneDuration?.zone_one_milli ?? 0,
          zoneTwo: zoneDuration?.zone_two_milli ?? 0,
          zoneThree: zoneDuration?.zone_three_milli ?? 0,
          zoneFour: zoneDuration?.zone_four_milli ?? 0,
          zoneFive: zoneDuration?.zone_five_milli ?? 0,
          syncedAt: Math.floor(Date.now() / 1000),
        };

        await db
          .insert(whoopWorkouts)
          .values(mapped)
          .onConflictDoUpdate({
            target: whoopWorkouts.id,
            set: {
              strain: mapped.strain,
              averageHeartrate: mapped.averageHeartrate,
              maxHeartrate: mapped.maxHeartrate,
              kilojoule: mapped.kilojoule,
              distanceMeters: mapped.distanceMeters,
              altitudeGainMeters: mapped.altitudeGainMeters,
              zoneZero: mapped.zoneZero,
              zoneOne: mapped.zoneOne,
              zoneTwo: mapped.zoneTwo,
              zoneThree: mapped.zoneThree,
              zoneFour: mapped.zoneFour,
              zoneFive: mapped.zoneFive,
              syncedAt: mapped.syncedAt,
            },
          });

        recordsSynced++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to sync workout ${workout.id}: ${msg}`);
      }
    }

    return {
      success: errors.length === 0,
      recordsSynced,
      errors,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      recordsSynced: 0,
      errors: [errorMessage],
      duration: Date.now() - startTime,
    };
  }
}

export async function syncWhoopSleep(options: SyncOptions = {}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let recordsSynced = 0;

  try {
    const accessToken = await getValidToken('whoop');
    if (!accessToken) {
      return {
        success: false,
        recordsSynced: 0,
        errors: ['No Whoop access token available'],
        duration: Date.now() - startTime,
      };
    }

    const limit = options.fullBackfill ? 100 : 20;
    const sleeps = await getWhoopSleeps(accessToken, { limit });

    for (const sleep of sleeps) {
      if (sleep.score_state !== 'SCORED') continue;

      try {
        const stageSummary = sleep.score?.stage_summary;
        const sleepNeeded = sleep.score?.sleep_needed;

        const mapped = {
          id: String(sleep.id),
          userId: sleep.user_id,
          startDate: Math.floor(new Date(sleep.start).getTime() / 1000),
          endDate: Math.floor(new Date(sleep.end).getTime() / 1000),
          startDateLocal: sleep.start,
          nap: sleep.nap,
          totalInBed: stageSummary?.total_in_bed_time_milli ?? 0,
          totalAwake: stageSummary?.total_awake_time_milli ?? 0,
          totalLight: stageSummary?.total_light_sleep_time_milli ?? 0,
          totalSlowWave: stageSummary?.total_slow_wave_sleep_time_milli ?? 0,
          totalRem: stageSummary?.total_rem_sleep_time_milli ?? 0,
          sleepCycleCount: stageSummary?.sleep_cycle_count ?? 0,
          disturbanceCount: stageSummary?.disturbance_count ?? 0,
          baselineNeed: sleepNeeded?.baseline_milli ?? 0,
          needFromDebt: sleepNeeded?.need_from_sleep_debt_milli ?? 0,
          needFromStrain: sleepNeeded?.need_from_recent_strain_milli ?? 0,
          needFromNap: sleepNeeded?.need_from_recent_nap_milli ?? 0,
          respiratoryRate: sleep.score?.respiratory_rate ?? 0,
          sleepPerformance: sleep.score?.sleep_performance_percentage ?? 0,
          sleepConsistency: sleep.score?.sleep_consistency_percentage ?? 0,
          sleepEfficiency: sleep.score?.sleep_efficiency_percentage ?? 0,
          syncedAt: Math.floor(Date.now() / 1000),
        };

        await db
          .insert(whoopSleep)
          .values(mapped)
          .onConflictDoUpdate({
            target: whoopSleep.id,
            set: {
              totalInBed: mapped.totalInBed,
              totalAwake: mapped.totalAwake,
              totalLight: mapped.totalLight,
              totalSlowWave: mapped.totalSlowWave,
              totalRem: mapped.totalRem,
              sleepCycleCount: mapped.sleepCycleCount,
              disturbanceCount: mapped.disturbanceCount,
              respiratoryRate: mapped.respiratoryRate,
              sleepPerformance: mapped.sleepPerformance,
              sleepConsistency: mapped.sleepConsistency,
              sleepEfficiency: mapped.sleepEfficiency,
              syncedAt: mapped.syncedAt,
            },
          });

        recordsSynced++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to sync sleep ${sleep.id}: ${msg}`);
      }
    }

    return {
      success: errors.length === 0,
      recordsSynced,
      errors,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      recordsSynced: 0,
      errors: [errorMessage],
      duration: Date.now() - startTime,
    };
  }
}

export async function syncWhoopRecovery(options: SyncOptions = {}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let recordsSynced = 0;

  try {
    const accessToken = await getValidToken('whoop');
    if (!accessToken) {
      return {
        success: false,
        recordsSynced: 0,
        errors: ['No Whoop access token available'],
        duration: Date.now() - startTime,
      };
    }

    const limit = options.fullBackfill ? 100 : 20;
    const recoveries = await getWhoopRecoveries(accessToken, { limit });

    for (const recovery of recoveries) {
      if (recovery.score_state !== 'SCORED') continue;

      try {
        const mapped = {
          cycleId: String(recovery.cycle_id),
          sleepId: String(recovery.sleep_id),
          userId: recovery.user_id,
          createdDate: Math.floor(new Date(recovery.created_at).getTime() / 1000),
          recoveryScore: recovery.score?.recovery_score ?? 0,
          restingHeartRate: recovery.score?.resting_heart_rate ?? 0,
          hrvRmssd: recovery.score?.hrv_rmssd_milli ?? 0,
          spo2: recovery.score?.spo2_percentage ?? null,
          skinTemp: recovery.score?.skin_temp_celsius
            ? Math.round(recovery.score.skin_temp_celsius * 100)
            : null,
          syncedAt: Math.floor(Date.now() / 1000),
        };

        await db
          .insert(whoopRecovery)
          .values(mapped)
          .onConflictDoUpdate({
            target: whoopRecovery.cycleId,
            set: {
              recoveryScore: mapped.recoveryScore,
              restingHeartRate: mapped.restingHeartRate,
              hrvRmssd: mapped.hrvRmssd,
              spo2: mapped.spo2,
              skinTemp: mapped.skinTemp,
              syncedAt: mapped.syncedAt,
            },
          });

        recordsSynced++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to sync recovery ${recovery.cycle_id}: ${msg}`);
      }
    }

    return {
      success: errors.length === 0,
      recordsSynced,
      errors,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      recordsSynced: 0,
      errors: [errorMessage],
      duration: Date.now() - startTime,
    };
  }
}

export async function syncWhoopCycles(options: SyncOptions = {}): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let recordsSynced = 0;

  try {
    const accessToken = await getValidToken('whoop');
    if (!accessToken) {
      return {
        success: false,
        recordsSynced: 0,
        errors: ['No Whoop access token available'],
        duration: Date.now() - startTime,
      };
    }

    const limit = options.fullBackfill ? 100 : 20;
    const cycles = await getWhoopCycles(accessToken, { limit });

    for (const cycle of cycles) {
      if (cycle.score_state !== 'SCORED') continue;

      try {
        const mapped = {
          id: String(cycle.id),
          userId: cycle.user_id,
          startDate: Math.floor(new Date(cycle.start).getTime() / 1000),
          endDate: Math.floor(new Date(cycle.end).getTime() / 1000),
          startDateLocal: cycle.start,
          timezone: cycle.timezone_offset,
          strain: cycle.score?.strain ?? 0,
          kilojoule: cycle.score?.kilojoule ?? 0,
          averageHeartrate: cycle.score?.average_heart_rate ?? 0,
          maxHeartrate: cycle.score?.max_heart_rate ?? 0,
          syncedAt: Math.floor(Date.now() / 1000),
        };

        await db
          .insert(whoopCycles)
          .values(mapped)
          .onConflictDoUpdate({
            target: whoopCycles.id,
            set: {
              strain: mapped.strain,
              kilojoule: mapped.kilojoule,
              averageHeartrate: mapped.averageHeartrate,
              maxHeartrate: mapped.maxHeartrate,
              syncedAt: mapped.syncedAt,
            },
          });

        recordsSynced++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to sync cycle ${cycle.id}: ${msg}`);
      }
    }

    return {
      success: errors.length === 0,
      recordsSynced,
      errors,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      recordsSynced: 0,
      errors: [errorMessage],
      duration: Date.now() - startTime,
    };
  }
}

// ==========================================
// Combined Whoop Sync
// ==========================================

export async function syncWhoopAll(options: SyncOptions = {}): Promise<SyncResult> {
  const workoutsResult = await syncWhoopWorkouts(options);
  const sleepResult = await syncWhoopSleep(options);
  const recoveryResult = await syncWhoopRecovery(options);
  const cyclesResult = await syncWhoopCycles(options);

  const combined: SyncResult = {
    success:
      workoutsResult.success &&
      sleepResult.success &&
      recoveryResult.success &&
      cyclesResult.success,
    recordsSynced:
      workoutsResult.recordsSynced +
      sleepResult.recordsSynced +
      recoveryResult.recordsSynced +
      cyclesResult.recordsSynced,
    errors: [
      ...workoutsResult.errors,
      ...sleepResult.errors,
      ...recoveryResult.errors,
      ...cyclesResult.errors,
    ],
    duration:
      workoutsResult.duration +
      sleepResult.duration +
      recoveryResult.duration +
      cyclesResult.duration,
  };

  await updateSyncState(
    'whoop',
    combined.success ? 'success' : 'error',
    combined.recordsSynced,
    combined.errors.join('; ') || undefined
  );

  if (combined.success) {
    try {
      const { emit } = await import('$lib/workflows/event-bus');
      emit('whoop_recovery_updated', { recordsSynced: combined.recordsSynced, syncedAt: new Date().toISOString() });
    } catch {
      // event-bus not critical path
    }
  }

  return combined;
}

// ==========================================
// Combined Sync (all services)
// ==========================================

export async function syncAll(options: SyncOptions = {}): Promise<SyncResponse> {
  const results: SyncResponse = { timestamp: new Date().toISOString() };

  const [stravaResult, whoopResult] = await Promise.allSettled([
    syncStravaActivities(options),
    syncWhoopAll(options),
  ]);

  if (stravaResult.status === 'fulfilled') results.strava = stravaResult.value;
  if (whoopResult.status === 'fulfilled') results.whoop = whoopResult.value;

  return results;
}
