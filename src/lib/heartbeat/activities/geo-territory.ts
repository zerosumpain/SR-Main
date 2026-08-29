import { db } from '$lib/db';
import { daydreamTrail } from '$lib/db/schema';
import { and, asc, eq, gt, isNotNull } from 'drizzle-orm';
import { getSetting } from '$lib/server/models/settings';
import { FAMILY_SUBJECTS, TRAIL_RETENTION_DAYS, errMsg } from '$lib/daydream/types';
import {
  GEO_EPOCH,
  WORKOUT_SUBJECT,
  ingestGeoTerritory,
  rollDailySnapshots,
  trailWatermarkKey,
  workoutWatermarkKey,
  type IngestReport,
} from '$lib/geo/service';
import type { ActivityHandler } from '../types';

const NAME = 'geo-territory';

/** Unset/null means enabled, matching the self-improvement engine and every
 *  daydream activity. Deliberately NOT `daydream.enabled`: the Apple workout
 *  corpus is half of this feature's input and has nothing to do with the trail,
 *  so turning daydreaming off should stop the trail growing, not stop territory
 *  being scored from workouts that arrived anyway. */
export const GEO_SETTINGS_ENABLED_KEY = 'geo.enabled';

interface GeoTerritoryConfig {
  /** Restrict the ingest to these trail subjects. Absent means everyone. */
  subjects?: string[];
  /** Include the Apple workout corpus. */
  includeWorkouts?: boolean;
  /** Roll the daily snapshot in the same run. */
  snapshots?: boolean;
  /** Forward-fill ceiling for the snapshot roll, in days. A repair is NOT
   *  capped by this — see rollDailySnapshots. */
  maxSnapshotDays?: number;
  /** How close to TRAIL_RETENTION_DAYS a watermark may drift before it is
   *  reported. 14 gives a fortnight of warning before evidence is deleted. */
  retentionWarnDays?: number;
}

const DEFAULTS: Required<Omit<GeoTerritoryConfig, 'subjects'>> = {
  includeWorkouts: true,
  snapshots: true,
  maxSnapshotDays: 7,
  retentionWarnDays: 14,
};

// ---------------------------------------------------------------------------
// Retention watch (spec risk 6)
//
// `pruneTrail` hard-deletes daydream_trail past TRAIL_RETENTION_DAYS, hourly.
// The ledger is append-only and independent of it (Decision 17), so captured
// ground survives — but the EVIDENCE does not. A scoring bug found on day 91
// cannot be repaired by a full replay, because there is nothing left to replay.
//
// That failure is silent by construction: the ledger keeps answering, the map
// keeps painting, and the only symptom is a watermark that stopped moving. So
// the hourly run measures two different distances and names them separately:
//
//   watermarkAgeDays     how far behind `now` the watermark sits. This is the
//                        REPLAY window. Once it passes retention, that
//                        subject's history can never be rebuilt from evidence,
//                        whether or not anything is currently being lost.
//
//   unreadOldestAgeDays  the age of the oldest trail fix the ledger has not yet
//                        consumed. This is ACTIVE LOSS: the pruner is coming
//                        for a row nothing has scored. Normally null, because a
//                        successful ingest always reads to the head — it is
//                        non-null exactly when the ingest has been failing or
//                        paused, which is the case this whole watch exists for.
//
// A subject that simply stopped reporting reads as `stale`, not `losing`, and
// that is correct rather than noisy: their territory genuinely cannot be
// rebuilt any more. A subject nothing has ever ingested reads as `never`.
// ---------------------------------------------------------------------------

export type RetentionLevel = 'ok' | 'never' | 'stale' | 'losing';

export interface RetentionInput {
  subject: string;
  /** The watermark as it stands AFTER this run, ISO. */
  watermark: string;
  /** Oldest trail fix later than the watermark, or null if there is none. */
  oldestUnreadTs: Date | null;
}

export interface RetentionEntry extends Omit<RetentionInput, 'oldestUnreadTs'> {
  watermarkAgeDays: number | null;
  unreadOldestAgeDays: number | null;
  level: RetentionLevel;
}

const DAY_MS = 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Classify each subject's distance from the retention cliff. Pure: no clock,
 * no database, so the thing that actually goes wrong — the arithmetic and the
 * boundary — is what the tests pin down.
 */
export function assessRetention(
  input: RetentionInput[],
  now: Date,
  opts: { retentionDays?: number; warnDays?: number } = {},
): RetentionEntry[] {
  const retentionDays = opts.retentionDays ?? TRAIL_RETENTION_DAYS;
  const warnDays = opts.warnDays ?? DEFAULTS.retentionWarnDays;
  // Warn once a value is within `warnDays` of the cliff, so there is a fortnight
  // to notice before the rows are gone rather than a report on the day of.
  const threshold = Math.max(0, retentionDays - warnDays);

  return input.map((row) => {
    const parsed = new Date(row.watermark);
    const valid = Number.isFinite(parsed.getTime());
    // The epoch is what a never-ingested subject reads as — `setSetting(k,null)`
    // cannot unset, so a reset writes GEO_EPOCH. Reporting that as a 20,000-day
    // watermark age would put every fresh install permanently in the red.
    const never = !valid || parsed.getTime() <= new Date(GEO_EPOCH).getTime();

    const watermarkAgeDays = never ? null : round1((now.getTime() - parsed.getTime()) / DAY_MS);
    const unreadOldestAgeDays = row.oldestUnreadTs
      ? round1((now.getTime() - row.oldestUnreadTs.getTime()) / DAY_MS)
      : null;

    // Active loss outranks a stale window: one is evidence about to be deleted,
    // the other is evidence already gone, and only the first can still be saved.
    let level: RetentionLevel = 'ok';
    if (unreadOldestAgeDays !== null && unreadOldestAgeDays >= threshold) level = 'losing';
    else if (never) level = 'never';
    else if (watermarkAgeDays !== null && watermarkAgeDays >= threshold) level = 'stale';

    return { subject: row.subject, watermark: row.watermark, watermarkAgeDays, unreadOldestAgeDays, level };
  });
}

/** The half-sentence a pulse summary carries, or null when nothing is at risk.
 *  `never` is not reported here — a subject with no history and no unread trail
 *  is the ordinary state of a family member who has not been backfilled yet. */
export function retentionSummary(entries: RetentionEntry[]): string | null {
  const losing = entries.filter((e) => e.level === 'losing');
  const stale = entries.filter((e) => e.level === 'stale');
  const bits: string[] = [];
  if (losing.length) {
    bits.push(
      `LOSING ${losing.map((e) => `${e.subject} ${e.unreadOldestAgeDays}d`).join(', ')} of ${TRAIL_RETENTION_DAYS}d unread`,
    );
  }
  if (stale.length) {
    bits.push(`no replay left for ${stale.map((e) => `${e.subject} ${e.watermarkAgeDays}d`).join(', ')}`);
  }
  return bits.length ? bits.join('; ') : null;
}

/**
 * Never the raw message in a pulse.
 *
 * A Drizzle failure embeds the statement and, on the line after it, every bound
 * parameter — which for this ingest is thousands of real GPS coordinates. A
 * pulse summary is stored in the database and rendered on the pulse board, so
 * the same rule /api/geo/rebuild follows applies here: the detail goes to the
 * server log, and what is recorded is the SHAPE of the failure. First line
 * only, because that is the driver's own complaint; the params are below it.
 */
export function safeError(err: unknown): string {
  const head = errMsg(err).split('\n')[0];
  return head.length > 160 ? `${head.slice(0, 160)}…` : head;
}

/** Oldest trail fix this subject's watermark has not passed. Ordered+limited
 *  rather than `min()` so it can walk the (subject, ts) index and stop. */
async function oldestUnreadFix(subject: string, after: Date): Promise<Date | null> {
  const [row] = await db
    .select({ ts: daydreamTrail.ts })
    .from(daydreamTrail)
    .where(
      and(
        eq(daydreamTrail.subject, subject),
        isNotNull(daydreamTrail.lat),
        gt(daydreamTrail.ts, after),
      ),
    )
    .orderBy(asc(daydreamTrail.ts))
    .limit(1);
  return row?.ts ?? null;
}

/**
 * Every subject the retention watch has an opinion about.
 *
 * The union of "has trail rows right now" and FAMILY_SUBJECTS, because those
 * two sets disagree in exactly the case that matters: a phone that has been
 * dark for four months has had all of its rows pruned, so a query over the
 * trail alone would drop the person whose replay window has just closed.
 */
async function watchedSubjects(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ subject: daydreamTrail.subject })
    .from(daydreamTrail)
    .where(isNotNull(daydreamTrail.lat));
  const set = new Set<string>(rows.map((r) => r.subject));
  for (const s of FAMILY_SUBJECTS) set.add(s.subject);
  return [...set].sort();
}

async function readRetention(now: Date, warnDays: number): Promise<RetentionEntry[]> {
  const subjects = await watchedSubjects();
  const input: RetentionInput[] = [];
  for (const subject of subjects) {
    const raw = await getSetting<string>(trailWatermarkKey(subject));
    const watermark = typeof raw === 'string' && raw ? raw : GEO_EPOCH;
    const at = new Date(watermark);
    const after = Number.isFinite(at.getTime()) ? at : new Date(GEO_EPOCH);
    input.push({ subject, watermark, oldestUnreadTs: await oldestUnreadFix(subject, after) });
  }
  return assessRetention(input, now, { warnDays });
}

const fmt = (n: number) => n.toLocaleString('en-GB');

/**
 * Hourly territory capture.
 *
 * ── Why the snapshot lives IN here ────────────────────────────────────────
 *
 * `geo_daily_snapshot` is a once-a-day write, and the obvious shape for it is a
 * daily heartbeat action with an overnight window. That shape is a trap this
 * repo has already been bitten by: `runOne` used to leave `next_run_at` on a
 * fixed wall-clock phase after an out-of-window skip, so any action whose
 * cadence divided into a day and whose phase sat outside its window skipped
 * FOREVER — daydream-bank had never run once and the weekly letter had never
 * been sent (see ../schedule.ts for the measurements). Short-cadence actions
 * self-heal because they try 24 times a day and one lands, which is why nobody
 * noticed for months.
 *
 * So the roll is a step inside an hourly, window-less action, and it derives
 * the day it owes from the table rather than from a settings key or from the
 * fact it is running. Twenty-three of the twenty-four calls each day find
 * nothing to do and cost one indexed lookup; the twenty-fourth writes
 * yesterday. After an outage it fills in what is missing without being told.
 *
 * ── Guarded, meaning it runs even when the ingest did not ─────────────────
 *
 * The two halves have no data dependency: the roll reads the ledger as it
 * stands, and yesterday's ownership does not become unanswerable because Home
 * Assistant was unreachable this hour. Letting an ingest failure skip the roll
 * would turn a transient outage into a permanent hole in the weekly board — the
 * one table that cannot be reconstructed later, because the scores it stores
 * decay against the clock. Each half is caught separately; either failing is a
 * real fault and is reported as one.
 *
 * No LLM, so the cost is zero.
 */
export const geoTerritory: ActivityHandler = {
  name: NAME,
  description:
    'Hourly landgrab territory capture. Watermarked ingest of the Life360 trail and the Apple workout corpus into the append-only capture ledger, recompute of the cells it touched, and a day-rollover write of geo_daily_snapshot in the same run — never a separate daily job, because a missed active-hours window skips forever. Also reports how close each subject is to the 90-day trail retention cliff, past which a scoring bug can no longer be repaired by replay. No LLM.',
  defaultCadenceSeconds: 3600,
  defaultEnabled: true,
  // Deliberately no active hours. Two reasons, and the second is the load-bearing
  // one: people walk at night, and an action with a window is an action that can
  // be locked out of it. See the doc comment above.
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as GeoTerritoryConfig) };

    const enabled = await getSetting<boolean>(GEO_SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      return { outcome: 'skipped', summary: 'territory capture disabled' };
    }

    // One instant for the whole run. The ingest resolves ownership as at `now`
    // and the roll derives "yesterday" from it, so sharing it keeps the two
    // halves talking about the same day even when the tick straddles midnight.
    const now = new Date(ctx.now);

    let report: IngestReport | null = null;
    let ingestError: string | null = null;
    try {
      report = await ingestGeoTerritory({
        now,
        subjects: cfg.subjects?.length ? cfg.subjects : undefined,
        includeWorkouts: cfg.includeWorkouts,
      });
    } catch (err) {
      ingestError = safeError(err);
      console.error('[geo-territory] ingest failed:', err);
    }

    // Derived rather than restated: the roll's report is the service's shape to
    // change, and a copy of it here would drift silently.
    let snapshots: Awaited<ReturnType<typeof rollDailySnapshots>> | null = null;
    let snapshotError: string | null = null;
    if (cfg.snapshots) {
      try {
        snapshots = await rollDailySnapshots({ now, maxDays: cfg.maxSnapshotDays });
      } catch (err) {
        snapshotError = safeError(err);
        console.error('[geo-territory] snapshot roll failed:', err);
      }
    }

    // Read after the ingest so it reflects the watermarks this run wrote, and
    // guarded too — the retention watch is a report about the job's health and
    // must never be the reason the job reports itself broken.
    let retention: RetentionEntry[] = [];
    let retentionError: string | null = null;
    try {
      retention = await readRetention(now, cfg.retentionWarnDays);
    } catch (err) {
      retentionError = safeError(err);
      console.error('[geo-territory] retention watch failed:', err);
    }

    const workoutWatermark = await getSetting<string>(workoutWatermarkKey(WORKOUT_SUBJECT)).catch(
      () => null,
    );

    const bits: string[] = [];
    if (report) {
      const fixes = report.subjects.reduce((n, s) => n + s.fixesRead, 0);
      bits.push(
        `${report.subjects.length} subject${report.subjects.length === 1 ? '' : 's'}, ` +
          `${fmt(fixes)} fixes + ${fmt(report.workouts.considered)} workouts → ` +
          // proposed vs written is the idempotency signal, and the pair is
          // always printed: a run that proposes 1,408 and writes 0 is the
          // hourly job working, not the hourly job doing nothing.
          `${fmt(report.claimsWritten)}/${fmt(report.claimsTotal)} claims, ` +
          `${fmt(report.totalEventsWritten)}/${fmt(report.totalEventsProposed)} events new, ` +
          `${fmt(report.tilesTouched)} cells`,
      );
      // The interior fill, said out loud. `fillTiles` is ground won by
      // enclosure rather than by treading, and `fillOutingsCapped` is the guard
      // rail firing — a journey whose interior was over the per-journey ceiling
      // and was therefore paid NOTHING. A steady non-zero there is the vehicle
      // gates leaking or the cap wanting a retune, and this line is the only
      // place either would ever be noticed.
      if (report.fillTiles || report.fillOutingsCapped) {
        bits.push(
          `fill ${fmt(report.fillTiles)} cells` +
            (report.fillOutingsCapped
              ? `, ${fmt(report.fillOutingsCapped)} capped (${fmt(report.fillInteriorRejected)} cells refused)`
              : ''),
        );
      }
    } else {
      bits.push(`ingest failed: ${ingestError}`);
    }

    if (snapshotError) bits.push(`snapshot failed: ${snapshotError}`);
    else if (snapshots?.days.length) {
      bits.push(
        `snapshots ${snapshots.days[0]}${snapshots.days.length > 1 ? `..${snapshots.days[snapshots.days.length - 1]}` : ''}` +
          ` (${snapshots.rows} rows${snapshots.repairedFrom ? `, repaired from ${snapshots.repairedFrom}` : ''})`,
      );
    }

    const warning = retentionSummary(retention);
    if (warning) bits.push(warning);

    // A retention warning is never an `error`. It would burn the action's
    // failure budget and eventually PAUSE the job — which is the one thing that
    // turns a watermark falling behind into a watermark that never moves again.
    const outcome = ingestError || snapshotError ? 'error' : 'ok';

    return {
      outcome,
      summary: bits.join(' · ') || 'nothing to do',
      costUsd: 0,
      details: {
        ingest: report,
        ingestError,
        snapshots,
        snapshotError,
        retention,
        retentionError,
        retentionWarnDays: cfg.retentionWarnDays,
        trailRetentionDays: TRAIL_RETENTION_DAYS,
        workoutWatermark: workoutWatermark ?? null,
      },
    };
  },
};
