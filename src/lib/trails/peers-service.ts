// The cohort behind every figure on an activity header.
//
// Read side only, server-only, and deliberately narrow: one activity's
// same-sport peers over the ninety days ending on its own day, reduced to the
// twelve numbers `$lib/health/activity-peers` knows how to place. The shapes it
// returns are that module's, so nothing here decides what a metric MEANS — this
// file only fetches and computes.
//
// Two things it must not do, both of which the obvious implementation does:
//
//  1. NEVER RE-DERIVE A FIGURE A DIFFERENT WAY FROM THE SUBJECT'S. TRIMP, EF,
//     HRR60 and METs all come out of the same helpers `getActivityPhysio` uses,
//     off the same columns, against the same HR profile. A cohort whose load
//     was estimated from average heart rate while the subject's was integrated
//     from its series is not a cohort — it is two instruments, and the
//     percentile between them is noise.
//
//  2. NEVER SHIP THE SERIES. The heart-rate samples are pulled to compute
//     TRIMP and are dropped here; what crosses to the browser is one row per
//     activity plus twelve aligned arrays of numbers.
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { activities, activitySeries } from '$lib/db/schema';
import { EFFECTIVE_TYPE, type ActivityDetail } from './activities-service';
import { efficiencyFactor } from '$lib/health/analytics/efficiency';
import { trimpFromAvg, trimpFromSamples, type HrSample } from '$lib/health/analytics/trimp';
import { hrr60, hrrCurve } from '$lib/health/analytics/hrr';
import { isPaceSport } from './format';
import { metsFrom, resolveHrProfile } from './physio-service';
import {
  PEER_WINDOW_DAYS,
  peerMetricKeys,
  type PeerActivity,
  type PeerSet,
} from '$lib/health/activity-peers';

/**
 * The widest cohort worth fetching.
 *
 * Production's biggest ninety-day set is 85 walks, so this is headroom rather
 * than a working limit — but it is the guard that stops a future year of daily
 * walks pulling a thousand heart-rate series into one page load.
 */
const MAX_PEERS = 250;

/**
 * The cohort, memoised per (type, window-end).
 *
 * Every activity in a given day's list shares a cohort, so a reader working
 * through a week of runs pays for the heart-rate scan once. The key carries the
 * window end because two outings on different days have genuinely different
 * cohorts — a memo keyed on type alone would hand August's runs June's peers.
 */
const MEMO_TTL_MS = 5 * 60 * 1000;
const memo = new Map<string, { at: number; value: Promise<PeerSet> }>();

export function getActivityPeers(
  detail: ActivityDetail,
  days = PEER_WINDOW_DAYS,
): Promise<PeerSet> {
  const key = `${detail.activityType}|${days}|${windowEnd(detail)}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.value;

  const value = loadPeers(detail, days);
  memo.set(key, { at: Date.now(), value });
  // A failed read must not be remembered as the answer — the same rule the
  // dashboard and segment corpus memos follow.
  value.catch(() => {
    if (memo.get(key)?.value === value) memo.delete(key);
  });
  return value;
}

/**
 * The epoch second the window closes on: the outing's own start.
 *
 * Read rule 1 in `activity-peers` for why this is not `now`. The window opens
 * exactly `days` before it, so the subject is always the newest member of its
 * own cohort and is always in it.
 */
function windowEnd(detail: ActivityDetail): number {
  return detail.startDate;
}

async function loadPeers(detail: ActivityDetail, days: number): Promise<PeerSet> {
  const to = windowEnd(detail);
  const from = to - days * 86400;

  const [profile, rows] = await Promise.all([
    resolveHrProfile(),
    db
      .select({
        id: activities.id,
        name: activities.name,
        startDate: activities.startDate,
        startDateLocal: activities.startDateLocal,
        durationS: activities.durationS,
        activeDurationS: activities.activeDurationS,
        distanceM: activities.distanceM,
        avgPaceSPerKm: activities.avgPaceSPerKm,
        elevationGainM: activities.elevationGainM,
        elevationLossM: activities.elevationLossM,
        avgHeartrate: activities.avgHeartrate,
        maxHeartrate: activities.maxHeartrate,
        activeEnergyKj: activities.activeEnergyKj,
        // Two scalars out of the metadata jsonb, projected in SQL. The column
        // itself carries the phone's per-minute stepCount, basalEnergy and
        // heartRate arrays — about 11 KB a row, for two numbers.
        heartRateRecovery: sql<unknown>`${activities.metadata} -> 'heartRateRecovery'`,
        intensity: sql<unknown>`${activities.metadata} -> 'intensity'`,
      })
      .from(activities)
      .where(
        and(
          // The EFFECTIVE type on both sides: a ride the watch logged as a walk
          // answers to "ride" everywhere else on the site, and its cohort has
          // to be the rides. Same partition `typicalForSport` applies.
          eq(EFFECTIVE_TYPE, detail.activityType),
          gte(activities.startDate, from),
          lte(activities.startDate, to),
        ),
      )
      .orderBy(desc(activities.startDate))
      .limit(MAX_PEERS),
  ]);

  // TRIMP is integrated from the heart-rate series where there is one, and
  // estimated from average heart rate where there is not — exactly as
  // `getActivityPhysio` decides it for the subject.
  const seriesById = new Map<string, HrSample[]>();
  if (rows.length) {
    const series = await db
      .select({ activityId: activitySeries.activityId, samples: activitySeries.samples })
      .from(activitySeries)
      .where(
        and(
          inArray(
            activitySeries.activityId,
            rows.map((r) => r.id),
          ),
          eq(activitySeries.metric, 'heart_rate'),
        ),
      );
    for (const s of series) seriesById.set(s.activityId, s.samples as HrSample[]);
  }

  const paceSport = isPaceSport(detail.activityType);
  const activityList: PeerActivity[] = [];
  const values: Record<string, Array<number | null>> = {};
  for (const key of peerMetricKeys(paceSport)) values[key] = [];

  let subjectIndex = -1;

  for (const r of rows) {
    if (r.id === detail.id) subjectIndex = activityList.length;
    activityList.push({
      id: r.id,
      name: r.name,
      day: (r.startDateLocal ?? '').slice(0, 10),
    });

    const duration = r.activeDurationS ?? r.durationS;
    const samples = seriesById.get(r.id) ?? null;
    const trimp =
      (samples ? trimpFromSamples(samples, profile) : null) ??
      (r.avgHeartrate ? trimpFromAvg(duration, r.avgHeartrate, profile) : null);

    values.distance.push(r.distanceM == null ? null : r.distanceM / 1000);
    values.moving.push(duration || null);
    values.pace.push(
      r.avgPaceSPerKm == null || !(r.avgPaceSPerKm > 0)
        ? null
        : paceSport
          ? r.avgPaceSPerKm
          : 3600 / r.avgPaceSPerKm,
    );
    values.climb.push(r.elevationGainM);
    values.descent.push(r.elevationLossM);
    values.avghr.push(r.avgHeartrate);
    values.maxhr.push(r.maxHeartrate);
    values.energy.push(r.activeEnergyKj);
    values.trimp.push(trimp);
    values.ef.push(efficiencyFactor(r.distanceM, duration, r.avgHeartrate));
    values.hrr60.push(hrr60(hrrCurve(r.heartRateRecovery)));
    values.mets.push(metsFrom(r.intensity));
  }

  return {
    activityType: detail.activityType,
    days,
    to: (detail.startDateLocal ?? '').slice(0, 10),
    activities: activityList,
    values,
    subjectIndex,
  };
}
