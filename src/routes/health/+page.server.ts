import type { PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { disclosureLeaks, pickPublic } from '$lib/health/public-payload';
import { getHealthSeries30d } from '$lib/health/series-30d-service';
import { getFeaturedActivities } from '$lib/health/featured-activities-service';
import { getReadiness } from '$lib/health/readiness-service';
import { getTrainingLoad } from '$lib/health/training-load-service';
import { getMonotony } from '$lib/health/services/monotony-service';
import { getRecoveryDebt } from '$lib/health/services/recovery-debt-service';
import { getAutonomicBalance } from '$lib/health/services/autonomic-balance-service';
import { getSleepRegularity } from '$lib/health/services/sleep-regularity-service';
import { getCircadianAlignment } from '$lib/health/services/circadian-service';
import { getVO2Max } from '$lib/health/services/vo2max-service';
import { getPolarised } from '$lib/health/services/polarised-service';
import { getStats } from '$lib/health/stats-service';
import { getTrailsDashboard, trend } from '$lib/trails/physio-service';
import {
  getSegmentHighlights,
  listSegments,
  type SegmentListRow,
} from '$lib/trails/segments-service';
import { getSegmentChains } from '$lib/trails/highlights-service';
import { getDailyPlan } from '$lib/trails/coach-service';
import { acwrSeries, preferredACWR } from '$lib/health/analytics/acwr';
import { localToday } from '$lib/health/day';
import { computeForecast } from '$lib/health/analytics/forecast';
import { GETTABLE_GAP_PCT } from '$lib/trails/segments/form';
import { computeMoves } from '$lib/health/moves';
import { computeTripwires, weeklyVolumeSummary, type GettableSummary } from '$lib/health/tripwires';
import { computeExperiments } from '$lib/health/experiments';
import { computeVerdict } from '$lib/health/verdict';

// /health is the ONE hub for the body and the ground it covers — the public
// landing and, signed in, the consolidated dashboard that used to live at
// /trails/dashboard.
//
// The split is enforced HERE, in the payload, not in the template. An anonymous
// visitor is never sent the owner data and then shown a different view of it:
// a GPS trace starts at the front door, and `{#if owner}` still ships the bytes
// to the browser. The two branches below have no overlap beyond the body
// metrics that have always been public.
//
// /health is matched EXACTLY in hooks.server.ts, so /health/activities and the
// rest of the hub's children go through the normal owner gate. `isOwnerRequest`
// is only what decides which of the two payloads THIS page builds — the same
// pattern the landing page and /decks use, and the only one that works on
// homeserv, where Google refuses private-network redirect URIs so no session
// can exist at all.

// Every analytic fails soft: anon users cannot hit the auth-gated /api/health/*
// endpoints, so all of this is computed server-side, and one bad service must
// never blank the page.
async function safe<T>(label: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.warn(`[health] "${label}" failed:`, (err as Error)?.message);
    return null;
  }
}

/**
 * The synchronous sibling of `safe()`. The derived layers below — forecast,
 * moves, tripwires, experiments, verdict — are pure functions rather than
 * queries, but they read a dozen optional structs each and the rule is the
 * same: one of them throwing must cost its own panel, never the page.
 */
function safeSync<T>(label: string, fn: () => T): T | null {
  try {
    return fn();
  } catch (err) {
    console.warn(`[health] "${label}" failed:`, (err as Error)?.message);
    return null;
  }
}

/** Segments capped well clear of the ~390 in production; hitting it is logged. */
const SEGMENT_LIMIT = 1000;

/**
 * The form taxonomy for the segments section, and the gettable count the
 * positive tripwire fires on. `segmentForm` has already done the work on every
 * row; this only counts it.
 */
function summariseSegmentForms(rows: SegmentListRow[]) {
  const withForm = rows.filter((r) => r.form.direction !== 'unknown');
  const improving = withForm.filter((r) => r.form.direction === 'improving');
  const gettable = improving.filter((r) => r.form.gapPct != null && r.form.gapPct < GETTABLE_GAP_PCT);
  const nearest =
    [...improving]
      .filter((r) => r.form.gapPct != null)
      .sort((a, b) => (a.form.gapPct as number) - (b.form.gapPct as number))[0] ?? null;
  const summary: GettableSummary = {
    gettable: gettable.length,
    improving: improving.length,
    withForm: withForm.length,
    nearest: nearest ? { name: nearest.name, gapPct: nearest.form.gapPct as number } : null,
  };
  return {
    ...summary,
    /** The four form tiles: everything without a read sits in `noRead`. */
    taxonomy: {
      improving: improving.length,
      holding: withForm.filter((r) => r.form.direction === 'holding').length,
      slipping: withForm.filter((r) => r.form.direction === 'slipping').length,
      noRead: rows.length - withForm.length,
      total: rows.length,
    },
    /** The gettable board itself, closest first — section F's proposed list. */
    board: gettable
      .slice()
      .sort((a, b) => (a.form.gapPct as number) - (b.form.gapPct as number))
      .slice(0, 10)
      .map((r) => ({
        id: r.id,
        name: r.name,
        activityType: r.activityType,
        gapPct: r.form.gapPct as number,
        daysSincePb: r.form.daysSincePb,
        effortCount: r.effortCount,
      })),
  };
}

export const load: PageServerLoad = async (event) => {
  const owner = await isOwnerRequest(event);

  // /health is ONE public URL serving two different documents, so the owner's
  // must never be cacheable by anything in front of it. cloudflared sits
  // between this app and the internet; a shared cache that stored the signed-in
  // response and replayed it to the next anonymous visitor would hand over the
  // whole hub. `Vary: Cookie` is the belt and `private, no-store` is the braces.
  event.setHeaders({ Vary: 'Cookie' });
  if (owner) event.setHeaders({ 'Cache-Control': 'private, no-store' });

  // getHealthSeries30d and getFeaturedActivities used to sit UNWRAPPED in this
  // Promise.all, so a database hiccup in either 500'd the whole page while the
  // ten analytics beside them degraded to a hidden section. They fail soft now
  // too; the page renders its own empty state.
  const [
    data,
    featuredActivities,
    readiness,
    trainingLoad,
    monotony,
    recoveryDebt,
    autonomic,
    sleepRegularity,
    circadian,
    vo2max,
    polarised,
    stats,
  ] = await Promise.all([
    safe('series-30d', getHealthSeries30d()),
    // Anonymous only. The hand-picked outings are the public landing's closing
    // chapter and nothing the owner dashboard renders reads them, so an owner
    // request paid for the query and shipped the rows for nothing.
    owner ? Promise.resolve(null) : safe('featured-activities', getFeaturedActivities()),
    safe('readiness', getReadiness()),
    safe('training-load', getTrainingLoad()),
    safe('monotony', getMonotony()),
    safe('recovery-debt', getRecoveryDebt()),
    safe('autonomic', getAutonomicBalance()),
    safe('sleep-regularity', getSleepRegularity()),
    safe('circadian', getCircadianAlignment()),
    safe('vo2max', getVO2Max()),
    safe('polarised', getPolarised()),
    safe('stats', getStats()),
  ]);

  const shared = {
    series: data?.series ?? [],
    today: data?.today ?? null,
    yesterday: data?.yesterday ?? null,
    headline: data?.headline ?? null,
    strap: data?.strap ?? '',
    rhrBaseline: data?.rhrBaseline ?? 0,
    rings: data?.rings ?? null,
    todayDeltas: data?.todayDeltas ?? null,
    syncedAgoSeconds: data?.syncedAgoSeconds ?? 0,
    narrative: data?.narrative ?? null,
    annotations: data?.annotations ?? [],
    provenance: data?.provenance ?? { seriesIsMock: false, correlationsAreIllustrative: false },
    readiness,
    trainingLoad,
    vo2max,
    sleepRegularity,
    stats,
    featuredActivities: featuredActivities ?? [],
  };

  if (!owner) {
    // Everything an anonymous visitor gets — and nothing else, because it is
    // built by PICKING from PUBLIC_FIELDS rather than by spreading. A field
    // added to `shared` later is therefore absent from the anonymous payload by
    // default, instead of present by accident.
    //
    // The correlations are deliberately not on that list: when nothing
    // correlates the service substitutes four hard-coded example findings
    // complete with r values and sample sizes, and a public page must not
    // present an invented result as a measurement.
    const publicPayload = pickPublic(shared);

    // The second belt, and it is buckled: the allow-list decides which KEYS go
    // out, this walks the VALUES that came back. It is a few hundred numbers,
    // so it costs microseconds, and it never blocks the page — an anonymous
    // visitor seeing an empty dashboard because a walker got clever is a worse
    // outcome than a logged line. If this ever fires, it is a real leak and the
    // log is where it will be noticed.
    const leaks = disclosureLeaks(publicPayload);
    if (leaks.length) {
      console.error(
        `[health] ANONYMOUS PAYLOAD DISCLOSURE — ${leaks.length} field(s): ${leaks.join(', ')}`,
      );
    }

    return { mode: 'public' as const, ...publicPayload };
  }

  // The dashboard is fetched FIRST and handed to the coach, which would
  // otherwise load the whole physio suite a second time inside the same
  // request. One extra round trip in sequence is cheaper than doing the
  // expensive half of this page twice.
  const dashboard = await safe('trails-dashboard', getTrailsDashboard());
  const [segments, chains, coach, segmentRows] = await Promise.all([
    safe('segment-highlights', getSegmentHighlights()),
    // Memoised on the same fingerprint as the highlight corpus, so the hub and
    // the segments explorer share one computation rather than each reloading
    // 1,136 activities and 6,317 efforts.
    safe('segment-chains', getSegmentChains(5)),
    safe(
      'coach',
      getDailyPlan({
        dashboard: dashboard ?? undefined,
        monotony,
        polarised,
        // The composite this page already computed. Without it the coach reads
        // readiness only as a downward veto, and proposed the same two-kilometre
        // walk on the best day of the fortnight as on the worst.
        readiness: readiness?.score ?? null,
      }),
    ),
    // Form on every segment, for the taxonomy tiles and the positive tripwire.
    // No geometry comes back — `listSegments` projects around `coordinates` —
    // and the effort read is three columns, the same one the explorer makes.
    safe('segment-forms', listSegments({ limit: SEGMENT_LIMIT })),
  ]);

  // ——— the instrument deck ————————————————————————————————————————
  //
  // Six of the eight panels were already on this payload (monotony, polarised,
  // circadian, autonomic, recovery debt, and sleep regularity in `shared`).
  // ACWR and efficiency were not, and neither needs a query of its own: the
  // dashboard has already computed both. The TRIMP-based ratio is the honest
  // one — the Whoop-strain ratio is an interim while the load history fills —
  // so it leads and strain is the fallback, but only when TRIMP is actually
  // READABLE: `preferredACWR` exists because `trimp ?? strain` preferred an
  // insufficient zero struct over a usable strain ratio for exactly the fill-in
  // period the fallback is for.
  const acwr = preferredACWR(dashboard?.load.trimpAcwr, dashboard?.load.strainAcwr);
  const efficiency = dashboard?.efficiency ?? null;
  // Europe/London, not UTC. Every bucket this is compared against — the week
  // Mondays, `startDateLocal`, the coach's own plan key — is a LOCAL day, so a
  // UTC `today` ran the volume summary, the tripwires, the experiments and the
  // verdict a day behind for the hour after midnight BST.
  const today = localToday();
  const segmentForms = segmentRows ? summariseSegmentForms(segmentRows.rows) : null;
  if (segmentRows && segmentRows.rows.length >= SEGMENT_LIMIT) {
    console.warn(
      `[health] segment form list hit the ${SEGMENT_LIMIT}-row cap — the taxonomy tiles and the ` +
        'gettable board now cover only the busiest segments.',
    );
  }

  // ——— the forecast ——————————————————————————————————————————————
  //
  // Four cards, each a projection with its own cone. All four are floored at 0
  // because none of these quantities can go negative and a cone that dips under
  // the axis is drawing an impossible future.
  const sleepDaily = (data?.series ?? [])
    // 0 is the missing sentinel throughout HealthDay — there are no nulls in it.
    .filter((d) => d.slept > 0)
    .map((d) => ({ date: d.date, value: d.slept }));
  const forecast = {
    sleep: safeSync('forecast-sleep', () =>
      sleepDaily.length ? computeForecast(trend(sleepDaily), { min: 0 }) : null,
    ),
    hrv: safeSync('forecast-hrv', () =>
      dashboard?.hrv ? computeForecast(dashboard.hrv, { min: 0 }) : null,
    ),
    vo2max: safeSync('forecast-vo2max', () =>
      dashboard?.vo2.series.length ? computeForecast(trend(dashboard.vo2.series), { min: 0 }) : null,
    ),
    acwr: safeSync('forecast-acwr', () =>
      dashboard?.load.days.length
        ? computeForecast(trend(acwrSeries(dashboard.load.days)), { min: 0 })
        : null,
    ),
  };

  // ——— the derived copy ————————————————————————————————————————————
  //
  // Moves, tripwires, experiments and the verdict are pure rules over the
  // numbers above. Nothing here calls a model, and each is wrapped so a throw
  // costs its own section rather than the page.
  const volume = weeklyVolumeSummary(dashboard?.weeks, today);
  const instrumentInputs = {
    readiness: readiness ? { score: readiness.score, label: readiness.label } : null,
    acwr,
    monotony,
    polarised,
    sri: sleepRegularity,
    circadian,
    autonomic,
    recoveryDebt,
    efficiency: efficiency?.bkm ?? null,
    vo2: vo2max,
    volume: volume ? { weekKm: volume.weekKm, medianKm: volume.medianKm } : null,
  };

  const moves = safeSync('moves', () => computeMoves(instrumentInputs)) ?? [];
  const tripwires =
    safeSync('tripwires', () =>
      computeTripwires({
        today,
        recoveryDebt,
        acwr,
        vo2: vo2max,
        hrv: dashboard?.hrv ?? null,
        rhr: dashboard?.rhr ?? null,
        recovery: dashboard?.recovery ?? null,
        weeks: dashboard?.weeks ?? null,
        segments: segmentForms,
      }),
    ) ?? [];
  const experiments =
    safeSync('experiments', () =>
      computeExperiments({
        today,
        sri: sleepRegularity,
        circadian,
        recoveryDebt,
        acwr,
        polarised,
        volume: instrumentInputs.volume,
        weeks: dashboard?.weeks ?? null,
      }),
    ) ?? [];
  const verdict = safeSync('verdict', () =>
    computeVerdict({
      today,
      moves,
      experiments,
      ...instrumentInputs,
      rhr: dashboard?.rhr ?? null,
      records: stats?.personalRecords ?? null,
    }),
  );

  return {
    mode: 'owner' as const,
    ...shared,
    // Four fields the owner dashboard has no reader for, dropped here rather
    // than shipped and ignored. `recentOutings()` was the expensive one: five
    // rows through `listActivities({ withPolyline: true })` plus the highlight
    // corpus, per request, for a route card no section on this page draws.
    // `correlations` and `narrative` cost no query — they arrive on `shared`
    // for the anonymous landing, which still renders both — but they are the
    // landing's furniture, so the owner payload does not carry them.
    narrative: null,
    // Whoop workouts back the Breakdown cards. Owner-only: each one carries a
    // sport and a clock, which is a routine, which is the thing the public
    // landing does not get.
    workouts: data?.workouts ?? [],
    monotony,
    recoveryDebt,
    autonomic,
    circadian,
    polarised,
    dashboard,
    segments,
    chains: chains ?? [],
    coach,
    // The two instrument-deck panels this payload did not already carry.
    acwr,
    efficiency,
    // Section C, D, E, H and I, all derived — no model, no schema change.
    forecast,
    moves,
    tripwires,
    experiments,
    verdict,
    // Section F: the form taxonomy, the gettable board, and the counts behind
    // the positive tripwire.
    segmentForms,
    volume,
  };
};
