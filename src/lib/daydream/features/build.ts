// src/lib/daydream/features/build.ts
//
// Turning the owner's health, activity, spend and diary into one row per day.
//
// The joining is the whole job. Apple stores a local ISO string with an offset,
// Whoop stores a unix epoch on one table and an ISO string with a Z on two
// others, and activities store a timestamptz. Every one has to become the same
// Europe/London calendar day before any two of them can be compared, and
// getting that wrong moves half of every evening onto the previous date.
//
// OWNER ONLY, and no trail, since P4a (2026-09-25). The household GPS trail
// and the per-person rows it fed were retired with the rest of location (spec
// D1 revised): nothing writes the trail any more. The movement columns
// (`minutesAtHome`, `distinctPlaces`, …) are no longer written, so a rebuild
// leaves whatever an earlier build put there and `correlate` no longer offers
// them.
//
// Normalisation of the VALUES lives in ./normalise.ts and is never repeated
// here. This file decides which rows belong to which day and how a day's worth
// of samples collapses to one number; that file decides what the numbers mean.

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activities,
  appleHealthMetrics,
  daydreamDayFeatures,
  daydreamSpend,
  whoopCycles,
  whoopRecovery,
  whoopSleep,
} from '$lib/db/schema';
import { DEFAULT_SUBJECT, LOCAL_TZ, errMsg } from '../types';
import {
  APPLE_AGGREGATION,
  aggregate,
  appleValue,
  msToMinutes,
  plausible,
  secondsToMinutes,
  strainValue,
} from './normalise';
import { fetchCalendarDays, toolChunkFetch, type CalendarDay } from './calendar';

/** How many days one build covers by default. */
export const DEFAULT_WINDOW_DAYS = 120;

export interface BuildResult {
  days: number;
  written: number;
  /** Days where a domain reported nothing at all, by domain. */
  absent: Record<string, number>;
  errors: string[];
}

export const EMPTY_BUILD: BuildResult = { days: 0, written: 0, absent: {}, errors: [] };

/** The Europe/London calendar day for an instant. */
export function localDay(d: Date, tz = LOCAL_TZ): string {
  // en-CA renders ISO-ordered YYYY-MM-DD, which is the only reason it is used
  // here — the alternative is hand-assembling parts and getting the padding
  // wrong.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * The local day for one of Apple's `date_local` strings.
 *
 * These already carry the local offset ("2026-08-26 08:20:47 +0100"), so the
 * date is the first ten characters and re-parsing would only introduce a chance
 * to shift it. Falls back to the epoch column when the string is malformed.
 */
export function appleLocalDay(dateLocal: string, epochSeconds: number): string {
  const head = dateLocal.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  return localDay(new Date(epochSeconds * 1000));
}

type DayBucket = {
  day: string;
  apple: Map<string, number[]>;
  strain: number[];
  recovery: Array<{ score: number; rhr: number; hrv: number }>;
  sleep: Array<{ minutes: number; performance: number | null; efficiency: number | null; disturbances: number | null }>;
  activities: Array<{ minutes: number | null; distanceM: number | null }>;
  /** Null = the diary could not be read for this day (absent), which is a
   *  different fact from a day it answered about with nothing on it. */
  calendar: CalendarDay | null;
  /** Minor units summed over verified spend rows; null until the spend table
   *  was readable for this build (then every day defaults to a true zero). */
  spendMinor: number | null;
};

function emptyBucket(day: string): DayBucket {
  return { day, apple: new Map(), strain: [], recovery: [], sleep: [], activities: [], calendar: null, spendMinor: null };
}

/**
 * Recompute the feature rows for a window.
 *
 * Reads everything for the window once and buckets in memory rather than
 * issuing a query per day: 120 days x 5 domains is 600 round trips, and the
 * whole window is a few tens of thousands of rows.
 */
export async function buildDayFeatures(
  opts: {
    windowDays?: number;
    now?: Date;
    /** Test seam. Production uses the site-tools registry via toolChunkFetch(). */
    calendarFetch?: Parameters<typeof fetchCalendarDays>[2];
  } = {},
): Promise<BuildResult> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  // Whoop, Apple Health, `daydream_spend` and the calendar have no subject
  // column — there is one owner and every row belongs to him.
  const subject = DEFAULT_SUBJECT;
  const now = opts.now ?? new Date();
  const from = new Date(now.getTime() - windowDays * 86_400_000);
  const result: BuildResult = { ...EMPTY_BUILD, absent: {}, errors: [] };

  const buckets = new Map<string, DayBucket>();
  const bucket = (day: string) => {
    let b = buckets.get(day);
    if (!b) {
      b = emptyBucket(day);
      buckets.set(day, b);
    }
    return b;
  };

  // ── Apple: 470k rows overall, so the window and metric list both matter ──
  try {
    const wanted = Object.keys(APPLE_AGGREGATION);
    const rows = await db
      .select({
        metricName: appleHealthMetrics.metricName,
        dateLocal: appleHealthMetrics.dateLocal,
        date: appleHealthMetrics.date,
        value: appleHealthMetrics.value,
      })
      .from(appleHealthMetrics)
      .where(
        and(
          gte(appleHealthMetrics.date, Math.floor(from.getTime() / 1000)),
          // `inArray`, not `= any(${array})`. Binding a JS array into raw SQL
          // here does not produce a Postgres array — it silently matches
          // nothing, and the whole Apple domain reported `absent` on all 236
          // days while 21,554 rows sat in the table. The integration test
          // caught it; nothing in the types would have.
          inArray(appleHealthMetrics.metricName, wanted),
        ),
      );
    for (const r of rows) {
      const v = appleValue(r.value);
      if (v == null) continue;
      const b = bucket(appleLocalDay(r.dateLocal, r.date));
      const list = b.apple.get(r.metricName) ?? [];
      list.push(v);
      b.apple.set(r.metricName, list);
    }
  } catch (err) {
    result.errors.push(`apple: ${errMsg(err)}`);
  }

  // ── Whoop cycles (strain) ──
  try {
    const rows = await db
      .select({ startDateLocal: whoopCycles.startDateLocal, strain: whoopCycles.strain })
      .from(whoopCycles);
    for (const r of rows) {
      const day = (r.startDateLocal ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const v = strainValue(r.strain);
      if (v != null) bucket(day).strain.push(v);
    }
  } catch (err) {
    result.errors.push(`whoop_cycles: ${errMsg(err)}`);
  }

  // ── Whoop recovery. `created_date` is a unix epoch, not a date. ──
  try {
    const rows = await db
      .select({
        createdDate: whoopRecovery.createdDate,
        recoveryScore: whoopRecovery.recoveryScore,
        restingHeartRate: whoopRecovery.restingHeartRate,
        hrvRmssd: whoopRecovery.hrvRmssd,
      })
      .from(whoopRecovery);
    for (const r of rows) {
      const day = localDay(new Date(r.createdDate * 1000));
      bucket(day).recovery.push({
        score: r.recoveryScore,
        rhr: r.restingHeartRate,
        hrv: r.hrvRmssd,
      });
    }
  } catch (err) {
    result.errors.push(`whoop_recovery: ${errMsg(err)}`);
  }

  // ── Whoop sleep. Durations are MILLISECONDS despite the column names. ──
  try {
    const rows = await db
      .select({
        startDateLocal: whoopSleep.startDateLocal,
        endDate: whoopSleep.endDate,
        nap: whoopSleep.nap,
        totalInBed: whoopSleep.totalInBed,
        totalAwake: whoopSleep.totalAwake,
        sleepPerformance: whoopSleep.sleepPerformance,
        sleepEfficiency: whoopSleep.sleepEfficiency,
        disturbanceCount: whoopSleep.disturbanceCount,
      })
      .from(whoopSleep);
    for (const r of rows) {
      if (r.nap) continue; // a nap is not the night
      // A night belongs to the day it ENDS on: "last night's sleep" is a
      // property of the morning, and filing it under the evening puts it a day
      // away from the recovery score it produced.
      const day = localDay(new Date(r.endDate * 1000));
      const inBed = msToMinutes(r.totalInBed);
      const awake = msToMinutes(r.totalAwake) ?? 0;
      if (inBed == null) continue;
      bucket(day).sleep.push({
        minutes: Math.max(0, inBed - awake),
        performance: r.sleepPerformance,
        efficiency: r.sleepEfficiency,
        disturbances: r.disturbanceCount,
      });
    }
  } catch (err) {
    result.errors.push(`whoop_sleep: ${errMsg(err)}`);
  }

  // ── Deliberate activity ──
  try {
    const rows = await db
      .select({
        startDateLocal: activities.startDateLocal,
        startDate: activities.startDate,
        durationS: activities.activeDurationS,
        fallbackDurationS: activities.durationS,
        distanceM: activities.distanceM,
      })
      .from(activities)
      // `start_date_local` is TEXT here, not a timestamp — the same
      // offset-carrying string Apple uses ("2025-01-01 16:26:18 +0000"). The
      // window is filtered on `startDate`, which is a unix epoch INTEGER (a
      // fifth time format in this one function), and the day comes off the
      // string's first ten characters so no re-parse can shift it.
      .where(gte(activities.startDate, Math.floor(from.getTime() / 1000)));
    for (const r of rows) {
      const day = (r.startDateLocal ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      bucket(day).activities.push({
        minutes: secondsToMinutes(r.durationS ?? r.fallbackDurationS),
        distanceM: r.distanceM,
      });
    }
  } catch (err) {
    result.errors.push(`activities: ${errMsg(err)}`);
  }

  // ── Spend: verified rows, summed per local day ──
  // The day column IS the local day (the extractor and the bank mapper both
  // key it that way), so this is a plain group-by. When the table is readable,
  // every bucketed day gets at least a zero — "no evidenced spend" is a real
  // observation of the evidence, deliberately unlike the sensor domains.
  let spendReadable = false;
  try {
    const rows = await db
      .select({ day: daydreamSpend.day, total: sql<number>`sum(${daydreamSpend.amountMinor})::int` })
      .from(daydreamSpend)
      .where(and(eq(daydreamSpend.verified, true), gte(daydreamSpend.day, localDay(from))))
      .groupBy(daydreamSpend.day);
    spendReadable = true;
    for (const r of rows) bucket(r.day).spendMinor = r.total;
  } catch (err) {
    result.errors.push(`spend: ${errMsg(err)}`);
  }

  // ── Calendar: whole window, chunked under the tool's 100-row cap ──
  // Unlike the other domains this is a live CalDAV read, not a table. A failed
  // chunk leaves its days ABSENT; a day the diary answered about with no events
  // is a real zero. Truncated or partially-read chunks mark their days partial.
  try {
    // Loaded once for the whole rebuild, not once per chunk — and not at all
    // when a caller supplied its own fetcher, which is how the tests run.
    let fetcher = opts.calendarFetch;
    if (!fetcher) {
      const { loadExclusionSet } = await import('../calendar/store');
      fetcher = toolChunkFetch(await loadExclusionSet());
    }
    const cal = await fetchCalendarDays(localDay(from), localDay(now), fetcher);
    for (const [day, row] of cal) bucket(day).calendar = row;
  } catch (err) {
    result.errors.push(`calendar: ${errMsg(err)}`);
  }

  // Spend zeros: only once the table proved readable, and only for days that
  // exist in the build at all — a day with no bucket has no row to be zero on.
  if (spendReadable) {
    for (const b of buckets.values()) if (b.spendMinor == null) b.spendMinor = 0;
  }

  // ── Collapse each day and write it ──
  const days = [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));
  result.days = days.length;

  for (const b of days) {
    try {
      const row = collapse(b, subject);
      for (const [domain, state] of Object.entries(row.sources)) {
        if (state === 'absent') result.absent[domain] = (result.absent[domain] ?? 0) + 1;
      }
      await db
        .insert(daydreamDayFeatures)
        .values(row)
        .onConflictDoUpdate({
          target: [daydreamDayFeatures.subject, daydreamDayFeatures.day],
          set: { ...row, computedAt: new Date() },
        });
      result.written++;
    } catch (err) {
      result.errors.push(`${b.day}: ${errMsg(err)}`);
    }
  }

  return result;
}

/** One day's samples to one row. Every absent measurement stays null. */
export function collapse(b: DayBucket, subject: string) {
  const appleAgg = (metric: string) => {
    const how = APPLE_AGGREGATION[metric];
    const values = b.apple.get(metric);
    if (!how || !values?.length) return null;
    return aggregate(values, how);
  };

  const sleep = b.sleep[0] ?? null;
  const recovery = b.recovery[0] ?? null;

  // A domain is 'absent' when it produced nothing, 'partial' when it produced
  // something the coverage gate distrusts, 'ok' otherwise. Never inferred from
  // a zero — that distinction is the reason this column exists.
  const sources: Record<string, string> = {
    apple: b.apple.size === 0 ? 'absent' : 'ok',
    whoopStrain: b.strain.length === 0 ? 'absent' : 'ok',
    whoopRecovery: b.recovery.length === 0 ? 'absent' : 'ok',
    whoopSleep: b.sleep.length === 0 ? 'absent' : 'ok',
    activities: b.activities.length === 0 ? 'absent' : 'ok',
    calendar: b.calendar == null ? 'absent' : b.calendar.partial ? 'partial' : 'ok',
    spend: b.spendMinor == null ? 'absent' : 'ok',
  };

  const activeMinutes = b.activities.length
    ? aggregate(
        b.activities.map((a) => a.minutes).filter((m): m is number => m != null),
        'sum',
      )
    : null;

  return {
    subject,
    day: b.day,

    // No trail columns: see the header. Omitted rather than nulled, so the
    // upsert leaves what an earlier build wrote.

    steps: plausible('steps', appleAgg('step_count')) != null
      ? Math.round(plausible('steps', appleAgg('step_count')) as number)
      : null,
    activeEnergyKj: appleAgg('active_energy'),
    meanHeartRate: plausible('meanHeartRate', appleAgg('heart_rate')),
    hrvMs: plausible('hrvMs', appleAgg('heart_rate_variability')),

    // Apple's device webhook is the owner's canonical HR source. Whoop remains
    // a fallback for historical rows, never a gate that can hide live Apple HR.
    restingHeartRate: plausible(
      'restingHeartRate',
      appleAgg('resting_heart_rate') ?? recovery?.rhr ?? null,
    ),
    recoveryScore: plausible('recoveryScore', recovery?.score ?? null),
    strain: plausible('strain', b.strain.length ? aggregate(b.strain, 'max') : null),

    sleepMinutes: plausible('sleepMinutes', sleep?.minutes ?? null),
    sleepPerformance: plausible('sleepPerformance', sleep?.performance ?? null),
    sleepEfficiency: sleep?.efficiency ?? null,
    disturbanceCount: sleep?.disturbances ?? null,

    workouts: b.activities.length || null,
    activeMinutes: plausible('activeMinutes', activeMinutes),
    activityDistanceM: b.activities.length
      ? aggregate(
          b.activities.map((a) => a.distanceM).filter((d): d is number => d != null),
          'sum',
        )
      : null,

    calendarEvents: b.calendar ? b.calendar.events : null,
    calendarBusyMinutes: b.calendar ? b.calendar.busyMinutes : null,

    verifiedSpendMinor: b.spendMinor,

    sources,
  };
}
