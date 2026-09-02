// src/lib/daydream/snapshot.ts
//
// Assembling everything a detector is allowed to look at, once per tick.
//
// Built once and handed to every detector, so they cannot disagree about
// what time it is, how well the sensor was working, or what the owner's own
// baseline is. Every source is best-effort and records what happened in
// `sources` — the briefing engine's shape, and for the same reason: a snapshot
// that silently lacks a source produces detectors that are silently wrong, and
// "quiet" and "broken" look identical from the outside.
//
// No new data sources. Everything here already existed; the value is the join.

import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamPlaces,
  daydreamMemoryThemes,
  daydreamSpend,
  daydreamTrail,
  heartbeatActions,
  intelNotes,
  intelTimelineEvents,
  jkaiMemories,
  researchSessions,
} from '$lib/db/schema';
import { coverageOf } from './cluster';
import { DEFAULT_SUBJECT, FAMILY_SUBJECTS, LOCAL_TZ, POLL_INTERVAL_MINS, errMsg } from './types';
import type {
  CalendarEvent,
  DaydreamSnapshot,
  InterestTerm,
  PlaceSummary,
  SnapshotSource,
  TrailPoint,
} from './snapshot-types';

/** How much trail a detector can see. Enough for a routine, bounded enough
 *  that the query stays cheap at a ten-minute cadence. */
const TRAIL_WINDOW_DAYS = 30;
/** How far back interests count as recent. */
const INTEREST_DAYS = 30;

function localParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LOCAL_TZ,
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const day = Math.max(0, order.indexOf(get('weekday')));
  return {
    localDate: `${get('year')}-${get('month')}-${get('day')}`,
    localDay: day,
    localHour: Number(get('hour')) % 24,
    isWeekday: day <= 4,
  };
}

export async function buildSnapshot(
  opts: { now?: Date; subject?: string } = {},
): Promise<DaydreamSnapshot> {
  const now = opts.now ?? new Date();
  const subject = opts.subject ?? DEFAULT_SUBJECT;
  const sources: SnapshotSource[] = [];
  const since = new Date(now.getTime() - TRAIL_WINDOW_DAYS * 86_400_000);

  // ── Trail ──────────────────────────────────────────────────────────────
  let trail: TrailPoint[] = [];
  let trailSpanDays = 0;
  try {
    const rows = await db
      .select({
        id: daydreamTrail.id,
        ts: daydreamTrail.ts,
        source: daydreamTrail.source,
        lat: daydreamTrail.lat,
        lon: daydreamTrail.lon,
        mode: daydreamTrail.mode,
        isHome: daydreamTrail.isHome,
        placeId: daydreamTrail.placeId,
        accuracyM: daydreamTrail.accuracyM,
      })
      .from(daydreamTrail)
      .where(and(eq(daydreamTrail.subject, subject), gte(daydreamTrail.ts, since)))
      .orderBy(daydreamTrail.ts);

    trail = rows as TrailPoint[];

    // The span is measured from the FIRST row ever, not from the window, so a
    // detector needing 28 days is not fooled by a 30-day query returning three
    // days of data.
    const [first] = await db
      .select({ ts: daydreamTrail.ts })
      .from(daydreamTrail)
      .where(eq(daydreamTrail.subject, subject))
      .orderBy(daydreamTrail.ts)
      .limit(1);
    trailSpanDays = first
      ? Math.floor((now.getTime() - first.ts.getTime()) / 86_400_000)
      : 0;

    sources.push({
      key: 'trail',
      status: trail.length ? 'ok' : 'empty',
      detail: `${trail.length} points, ${trailSpanDays} days on record`,
    });
  } catch (err) {
    sources.push({ key: 'trail', status: 'failed', detail: errMsg(err) });
  }

  // ── Places ─────────────────────────────────────────────────────────────
  let places: PlaceSummary[] = [];
  try {
    // ACTIVE only. `atPlace` and `placesNearby` read this list, and before the
    // stillness rule it also carried every stretch of road the old dwell
    // measure had promoted — so driving through a junction could set
    // `atPlaceKind` for any rule that asked. A retired, merged or muted place
    // is not somewhere you are.
    places = (await db
      .select()
      .from(daydreamPlaces)
      .where(eq(daydreamPlaces.status, 'active'))) as unknown as PlaceSummary[];
    sources.push({
      key: 'places',
      status: places.length ? 'ok' : 'empty',
      detail: `${places.length} places, ${places.filter((p) => p.label).length} named`,
    });
  } catch (err) {
    sources.push({ key: 'places', status: 'failed', detail: errMsg(err) });
  }

  // ── Current position ───────────────────────────────────────────────────
  const positioned = trail.filter((t) => t.lat != null && t.lon != null);
  const last = positioned[positioned.length - 1];
  const current = last
    ? {
        ts: last.ts,
        lat: last.lat as number,
        lon: last.lon as number,
        mode: last.mode,
        isHome: last.isHome,
        placeId: last.placeId,
        accuracyM: last.accuracyM,
        ageMins: Math.max(0, Math.round((now.getTime() - last.ts.getTime()) / 60000)),
      }
    : null;

  // ── Coverage ───────────────────────────────────────────────────────────
  //
  // The interval is read from the observe action's LIVE cadence, not assumed.
  // The compile-time constant already ties the default to the divisor, but the
  // cadence is editable per row, and a row edited to 600s against a divisor of
  // 120s would quietly re-open exactly the hole this is here to close: coverage
  // reading 1.0 while most of the window went unobserved.
  let pollIntervalMins = POLL_INTERVAL_MINS;
  try {
    const [observe] = await db
      .select({ cadenceSeconds: heartbeatActions.cadenceSeconds })
      .from(heartbeatActions)
      .where(eq(heartbeatActions.name, 'daydream-observe'))
      .limit(1);
    if (observe?.cadenceSeconds && observe.cadenceSeconds > 0) {
      pollIntervalMins = observe.cadenceSeconds / 60;
    }
  } catch {
    // Fall back to the constant. A coverage figure from the default interval is
    // still meaningful; refusing to compute one would silence every detector.
  }

  const cov = (hours: number) =>
    coverageOf(
      trail.map((t) => ({ ts: t.ts, source: t.source })),
      new Date(now.getTime() - hours * 3_600_000),
      now,
      pollIntervalMins,
    );
  const coverage = { last24h: cov(24), last7d: cov(24 * 7), pollIntervalMins };

  // ── Health ─────────────────────────────────────────────────────────────
  const health: DaydreamSnapshot['health'] = {
    lastNightSleep: null,
    sleepBaseline: null,
    readiness: null,
    daysSinceWorkout: null,
    trainingLoad: null,
  };
  /** Set when a sleep reading could not possibly be true. Reported on the
   *  source list below, so the fault is visible rather than merely absent. */
  let sleepProblem: string | null = null;
  try {
    const { getSleepAnalysis } = await import('$lib/health/sleep-analysis-service');
    const { checkReading, msToMinutes } = await import('./health-quality');
    const sleep = await getSleepAnalysis();

    // ── Units, then plausibility, in that order ────────────────────────────
    //
    // `totalDuration` is `whoop_sleep.total_in_bed`, which is MILLISECONDS —
    // the schema says so on the line above the column. This assigned it
    // straight into a field called `durationMins`, so 27,841,092 ms of a
    // perfectly ordinary 7h44m night was carried as 27,841,092 minutes and
    // rendered on the feed as "464,018 hours of sleep".
    //
    // The reviewer caught that one, which is the review stage doing its job and
    // is also three stages too late: the number had already been through a
    // detector, a thought, the ponder pack and the rule engine. So the tripwire
    // the FEATURES pipeline has always had now guards this pipeline too, and a
    // rejected reading is reported rather than merely absent — a source that has
    // started emitting impossible numbers is a fault, and a fault that shows up
    // only as silence is indistinguishable from a quiet week.
    if (sleep?.latest) {
      const endedAt = new Date(sleep.latest.endedAt);
      const ageHours = (now.getTime() - endedAt.getTime()) / 3_600_000;
      if (!Number.isFinite(ageHours) || ageHours < -2 || ageHours > 36) {
        sleepProblem = `latest sleep ended ${Number.isFinite(ageHours) ? `${Math.round(ageHours)}h ago` : 'at an invalid time'} — not treated as last night`;
      }
      const duration = checkReading('sleepMinutes', msToMinutes(sleep.latest.totalDuration));
      const performance = checkReading('sleepPerformance', sleep.latest.performance);
      const problems = [duration.problem, performance.problem].filter(Boolean) as string[];

      // Reported here and now, on the source list the hub's attention band
      // reads. Going and FIXING it is the nightly improvement run's job, which
      // pulls the same check via `collectHealthFaults` — pushing from a
      // ten-minute snapshot would have closed a module cycle, and the gate was
      // right to refuse it.
      if (problems.length) sleepProblem = problems.join('; ');

      // Both halves or neither. "You slept well" beside a duration that was
      // thrown away is a claim resting on a number nobody can see.
      if (!sleepProblem && duration.value != null && performance.value != null) {
        health.lastNightSleep = { performance: performance.value, durationMins: duration.value };
      }
    }
    // The owner's OWN recent average, never a population norm. Needs enough
    // nights to mean anything — below that the baseline stays null and the
    // detector that uses it reports itself not ready.
    const trend = (sleep?.trend ?? []).filter(
      (t) => Number.isFinite(t.performance) && t.performance > 0 && t.date !== sleep?.latest?.date,
    );
    if (trend.length >= 7) {
      // Median of the preceding fortnight: one disrupted or mis-recorded night
      // should not move the definition of "usual" enough to hide the disruption.
      const recent = trend.slice(-14).map((t) => t.performance).sort((a, b) => a - b);
      const mid = Math.floor(recent.length / 2);
      health.sleepBaseline = recent.length % 2
        ? recent[mid]
        : (recent[mid - 1] + recent[mid]) / 2;
    }
    sources.push({
      key: 'sleep',
      // A rejected reading is a FAILURE, not an absence. The Engine tab reads
      // this list, and "empty" there would say the night simply had no data.
      status: sleepProblem ? 'failed' : health.lastNightSleep ? 'ok' : 'empty',
      detail:
        sleepProblem ??
        (health.sleepBaseline == null ? 'no baseline yet' : `baseline ${Math.round(health.sleepBaseline)}`),
    });
  } catch (err) {
    sources.push({ key: 'sleep', status: 'failed', detail: errMsg(err) });
  }

  try {
    const { getTrainingLoad } = await import('$lib/health/training-load-service');
    const load = await getTrainingLoad();
    if (load) {
      health.trainingLoad = { ratio: load.ratio, zone: load.zone };
      // Last day with any load at all is the last workout.
      const withLoad = (load.history ?? []).filter((h) => h.load > 0);
      const latest = withLoad[withLoad.length - 1];
      if (latest) {
        const d = new Date(latest.date);
        health.daysSinceWorkout = Math.max(
          0,
          Math.floor((now.getTime() - d.getTime()) / 86_400_000),
        );
      }
    }
    sources.push({
      key: 'training-load',
      status: health.daysSinceWorkout == null ? 'empty' : 'ok',
      detail:
        health.daysSinceWorkout == null
          ? 'no workout history'
          : `${health.daysSinceWorkout} days since last`,
    });
  } catch (err) {
    sources.push({ key: 'training-load', status: 'failed', detail: errMsg(err) });
  }

  try {
    const { getReadiness } = await import('$lib/health/readiness-service');
    const r = await getReadiness();
    // getReadiness() defaults every missing factor to 50 and always returns a
    // score, so a score alone is not evidence of data. The HRV factor carries
    // its raw inputs only when a real recovery row existed — that is the gate
    // between "readiness is 50" and "there is nothing to be ready about".
    const observedAt = r.factors.hrvTrend.observedAt
      ? new Date(r.factors.hrvTrend.observedAt)
      : null;
    const ageHours = observedAt ? (now.getTime() - observedAt.getTime()) / 3_600_000 : Infinity;
    const hasRealData =
      (r.factors.hrvTrend.raw != null || r.factors.hrvTrend.avg7d != null) &&
      Number.isFinite(ageHours) &&
      ageHours >= -2 &&
      ageHours <= 48;
    if (hasRealData) health.readiness = { score: Math.round(r.score), label: r.label };
    sources.push({
      key: 'readiness',
      status: health.readiness ? 'ok' : 'empty',
      detail: health.readiness
        ? `${health.readiness.score} (${health.readiness.label}, ${r.factors.hrvTrend.source ?? 'unknown source'})`
        : observedAt && Number.isFinite(ageHours)
          ? `recovery data is stale (${Math.round(ageHours)}h old)`
          : 'no recovery data',
    });
  } catch (err) {
    sources.push({ key: 'readiness', status: 'failed', detail: errMsg(err) });
  }

  // ── Calendar ───────────────────────────────────────────────────────────
  const calendar: DaydreamSnapshot['calendar'] = {
    events: [],
    hiddenCount: 0,
    partial: false,
    available: false,
  };
  try {
    // One reader, one filter. Every occurrence the owner has excluded is gone
    // before a detector or a prompt can see it — see calendar/read.ts.
    const { readCalendar } = await import('./calendar/read');
    const { loadExclusionSet } = await import('./calendar/store');
    const read = await readCalendar(
      { dateRangeStart: 'today', dateRangeEnd: '+1d' },
      await loadExclusionSet(),
    );
    if (read.available) {
      calendar.available = true;
      calendar.partial = read.partial;
      calendar.hiddenCount = read.hidden.length;
      calendar.events = read.events.map(
        (e) =>
          ({
            uid: e.uid,
            title: e.title,
            start: new Date(e.start),
            end: e.end ? new Date(e.end) : null,
            location: e.location,
          }) satisfies CalendarEvent,
      );
    }
    sources.push({
      key: 'calendar',
      status: calendar.available ? (calendar.partial ? 'unavailable' : 'ok') : 'failed',
      detail: calendar.partial
        ? 'partial read — treated as unknown, not empty'
        : `${calendar.events.length} events` +
          (calendar.hiddenCount ? ` (${calendar.hiddenCount} excluded by you)` : ''),
    });
  } catch (err) {
    sources.push({ key: 'calendar', status: 'failed', detail: errMsg(err) });
  }

  // ── Interests: research topics + recent intel note titles ──────────────
  const interests: InterestTerm[] = [];
  const interestSince = new Date(now.getTime() - INTEREST_DAYS * 86_400_000);
  try {
    const research = await db
      .select({ id: researchSessions.id, topic: researchSessions.topic, createdAt: researchSessions.createdAt })
      .from(researchSessions)
      .where(gte(researchSessions.createdAt, interestSince))
      .orderBy(desc(researchSessions.createdAt))
      .limit(40);
    for (const r of research) {
      if (r.topic?.trim()) {
        interests.push({ term: r.topic.trim(), source: 'research', at: r.createdAt, refId: r.id });
      }
    }
    sources.push({ key: 'research', status: research.length ? 'ok' : 'empty', detail: `${research.length} sessions` });
  } catch (err) {
    sources.push({ key: 'research', status: 'failed', detail: errMsg(err) });
  }

  try {
    // `observedAt` is the ingest-clock lesson from intel: createdAt is when the
    // sweep ran, not when the thing happened, and ranking on it makes an
    // eleven-week-old thread look like this morning's.
    const notes = await db
      .select({ id: intelNotes.id, title: intelNotes.title, observedAt: intelNotes.observedAt, createdAt: intelNotes.createdAt })
      .from(intelNotes)
      .where(and(isNotNull(intelNotes.title), gte(sql`coalesce(${intelNotes.observedAt}, ${intelNotes.createdAt})`, interestSince)))
      .orderBy(desc(sql`coalesce(${intelNotes.observedAt}, ${intelNotes.createdAt})`))
      .limit(60);
    for (const n of notes) {
      if (n.title?.trim()) {
        interests.push({
          term: n.title.trim(),
          source: 'intel',
          at: n.observedAt ?? n.createdAt,
          refId: n.id,
        });
      }
    }
    sources.push({ key: 'intel', status: notes.length ? 'ok' : 'empty', detail: `${notes.length} notes` });
  } catch (err) {
    sources.push({ key: 'intel', status: 'failed', detail: errMsg(err) });
  }

  // ── Memories ───────────────────────────────────────────────────────────
  let memories: DaydreamSnapshot['memories'] = [];
  let memoryThemes: DaydreamSnapshot['memoryThemes'] = [];
  try {
    [memories, memoryThemes] = await Promise.all([
      db
        .select({ id: jkaiMemories.id, category: jkaiMemories.category, content: jkaiMemories.content })
        .from(jkaiMemories)
        .where(and(isNull(jkaiMemories.supersededBy), isNull(jkaiMemories.consolidatedAt)))
        // Raw rows are a short-lived bridge: something learned during the day
        // can matter before tonight, then leaves this list once it has either
        // joined a theme or been explicitly judged non-durable.
        .orderBy(desc(jkaiMemories.createdAt))
        .limit(40),
      db
        .select({
          id: daydreamMemoryThemes.id,
          kind: daydreamMemoryThemes.kind,
          title: daydreamMemoryThemes.title,
          statement: daydreamMemoryThemes.statement,
          guidance: daydreamMemoryThemes.guidance,
          confidence: daydreamMemoryThemes.confidence,
          sourceCount: daydreamMemoryThemes.sourceCount,
        })
        .from(daydreamMemoryThemes)
        .where(eq(daydreamMemoryThemes.status, 'active'))
        // Repeatedly-supported themes earn the front of the pack. Recency only
        // breaks a tie; one noisy new episode must not evict a durable value.
        .orderBy(desc(daydreamMemoryThemes.sourceCount), desc(daydreamMemoryThemes.updatedAt))
        .limit(80),
    ]);
    sources.push({
      key: 'memories',
      status: memories.length || memoryThemes.length ? 'ok' : 'empty',
      detail: `${memoryThemes.length} themes · ${memories.length} awaiting tonight`,
    });
  } catch (err) {
    sources.push({ key: 'memories', status: 'failed', detail: errMsg(err) });
  }

  // ── Email facts ────────────────────────────────────────────────────────
  // The intel ingest has been extracting dated events from email nightly for
  // months; until 2026-08-27 daydream read only note TITLES. These are the
  // structured rows — a renewal, an appointment, a delivery — with the event's
  // own date, which is what lets a thought look FORWARD.
  let emailFacts: DaydreamSnapshot['emailFacts'] = {
    available: false,
    upcoming: [],
    recent: [],
  };
  try {
    const today = localParts(now).localDate;
    const horizon = new Date(now.getTime() + 60 * 86_400_000).toISOString().slice(0, 10);
    const recentFloor = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    const pick = {
      id: intelTimelineEvents.id,
      date: intelTimelineEvents.date,
      type: intelTimelineEvents.type,
      title: intelTimelineEvents.title,
      noteId: intelTimelineEvents.noteId,
    };
    const upcoming = await db
      .select(pick)
      .from(intelTimelineEvents)
      .where(and(gte(intelTimelineEvents.date, today), sql`${intelTimelineEvents.date} <= ${horizon}`))
      .orderBy(intelTimelineEvents.date)
      .limit(40);
    const recent = await db
      .select(pick)
      .from(intelTimelineEvents)
      .where(and(gte(intelTimelineEvents.date, recentFloor), sql`${intelTimelineEvents.date} < ${today}`))
      .orderBy(desc(intelTimelineEvents.date))
      .limit(20);
    emailFacts = { available: true, upcoming, recent };
    sources.push({
      key: 'email-facts',
      status: upcoming.length + recent.length ? 'ok' : 'empty',
      detail: `${upcoming.length} upcoming, ${recent.length} recent dated events`,
    });
  } catch (err) {
    sources.push({ key: 'email-facts', status: 'failed', detail: errMsg(err) });
  }

  // ── Spend ──────────────────────────────────────────────────────────────
  // Verified rows only — the quarantine is the email extractor's whole point,
  // and the bank rows are born verified. Written since merge 5 (2026-08-26)
  // and read by NOTHING until 2026-08-27.
  let spend: DaydreamSnapshot['spend'] = { available: false, recent: [], totalMinor30d: 0 };
  try {
    const floor = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const rows = await db
      .select({
        id: daydreamSpend.id,
        day: daydreamSpend.day,
        merchant: daydreamSpend.merchant,
        amountMinor: daydreamSpend.amountMinor,
        currency: daydreamSpend.currency,
      })
      .from(daydreamSpend)
      .where(and(eq(daydreamSpend.verified, true), gte(daydreamSpend.day, floor)))
      .orderBy(desc(daydreamSpend.day))
      .limit(100);
    spend = {
      available: true,
      recent: rows.slice(0, 30),
      totalMinor30d: rows.reduce((a, r) => a + r.amountMinor, 0),
    };
    sources.push({
      key: 'spend',
      status: rows.length ? 'ok' : 'empty',
      detail: `${rows.length} verified rows in 30d`,
    });
  } catch (err) {
    sources.push({ key: 'spend', status: 'failed', detail: errMsg(err) });
  }

  // ── Family ─────────────────────────────────────────────────────────────
  // Coordinate-free by construction: what leaves this section is home-or-not,
  // a confirmed place label, and a distance — the same discipline the compose
  // fact block applies to the owner's own trail. A member with no positioned
  // fix in the window still appears, with nulls, so "not tracked right now"
  // never reads as "not at home".
  let family: DaydreamSnapshot['family'] = { available: false, members: [] };
  try {
    const others = FAMILY_SUBJECTS.filter((f) => f.subject !== subject);
    const members: DaydreamSnapshot['family']['members'] = [];
    for (const f of others) {
      const [row] = await db
        .select({
          ts: daydreamTrail.ts,
          isHome: daydreamTrail.isHome,
          placeId: daydreamTrail.placeId,
          distanceHomeKm: daydreamTrail.distanceHomeKm,
        })
        .from(daydreamTrail)
        .where(and(eq(daydreamTrail.subject, f.subject), isNotNull(daydreamTrail.lat)))
        .orderBy(desc(daydreamTrail.ts))
        .limit(1);
      const place = row?.placeId ? places.find((pl) => pl.id === row.placeId) : null;
      members.push({
        subject: f.subject,
        isHome: row?.isHome ?? null,
        placeLabel: place?.label ?? null,
        distanceHomeKm: row?.distanceHomeKm ?? null,
        ageMins: row ? Math.round((now.getTime() - row.ts.getTime()) / 60_000) : null,
        lastSeenAt: row?.ts ?? null,
      });
    }
    family = { available: true, members };
    const seen = members.filter((m) => m.lastSeenAt != null).length;
    sources.push({
      key: 'family',
      status: seen ? 'ok' : 'empty',
      detail: `${seen}/${members.length} members with a positioned fix`,
    });
  } catch (err) {
    sources.push({ key: 'family', status: 'failed', detail: errMsg(err) });
  }

  // ── Offers ─────────────────────────────────────────────────────────────
  // `available` is about whether the INDEX exists, not whether it currently
  // holds anything. An empty index and a missing one look identical from a
  // detector's side, and conflating them is how a broken feature passes for a
  // quiet one — so a read failure reports unavailable, and an empty result
  // reports available-and-empty.
  let offers: DaydreamSnapshot['offers'] = { available: false, items: [] };
  try {
    const { listActiveOffers } = await import('./offers');
    const rows = await listActiveOffers();
    offers = {
      available: true,
      items: rows.map((o) => ({
        id: o.id,
        merchant: o.merchant,
        summary: o.summary,
        expiresAt: o.expiresAt,
        emailId: o.noteId ?? o.id,
      })),
    };
    sources.push({
      key: 'offers',
      status: rows.length ? 'ok' : 'empty',
      detail: `${rows.length} live offers`,
    });
  } catch (err) {
    sources.push({ key: 'offers', status: 'failed', detail: errMsg(err) });
  }

  return {
    now,
    ...localParts(now),
    current,
    trail,
    trailDays: TRAIL_WINDOW_DAYS,
    trailSpanDays,
    places,
    coverage,
    health,
    calendar,
    interests,
    offers,
    memories,
    memoryThemes,
    emailFacts,
    spend,
    family,
    sources,
  };
}
