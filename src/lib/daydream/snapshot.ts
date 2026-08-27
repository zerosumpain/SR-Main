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

import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamPlaces,
  daydreamTrail,
  heartbeatActions,
  intelNotes,
  jkaiMemories,
  researchSessions,
} from '$lib/db/schema';
import { coverageOf } from './cluster';
import { DEFAULT_SUBJECT, LOCAL_TZ, POLL_INTERVAL_MINS, errMsg } from './types';
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
    places = (await db.select().from(daydreamPlaces)) as unknown as PlaceSummary[];
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
  const coverage = { last24h: cov(24), last7d: cov(24 * 7) };

  // ── Health ─────────────────────────────────────────────────────────────
  const health: DaydreamSnapshot['health'] = {
    lastNightSleep: null,
    sleepBaseline: null,
    readiness: null,
    daysSinceWorkout: null,
    trainingLoad: null,
  };
  try {
    const { getSleepAnalysis } = await import('$lib/health/sleep-analysis-service');
    const sleep = await getSleepAnalysis();
    if (sleep?.latest) {
      health.lastNightSleep = {
        performance: sleep.latest.performance,
        durationMins: Math.round(sleep.latest.totalDuration),
      };
    }
    // The owner's OWN recent average, never a population norm. Needs enough
    // nights to mean anything — below that the baseline stays null and the
    // detector that uses it reports itself not ready.
    const trend = (sleep?.trend ?? []).filter((t) => Number.isFinite(t.performance));
    if (trend.length >= 7) {
      const recent = trend.slice(-14);
      health.sleepBaseline =
        recent.reduce((a, t) => a + t.performance, 0) / recent.length;
    }
    sources.push({
      key: 'sleep',
      status: health.lastNightSleep ? 'ok' : 'empty',
      detail: health.sleepBaseline == null ? 'no baseline yet' : `baseline ${Math.round(health.sleepBaseline)}`,
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
    const hasRealData = r.factors.hrvTrend.raw != null || r.factors.hrvTrend.avg7d != null;
    if (hasRealData) health.readiness = { score: Math.round(r.score), label: r.label };
    sources.push({
      key: 'readiness',
      status: health.readiness ? 'ok' : 'empty',
      detail: health.readiness ? `${health.readiness.score} (${health.readiness.label})` : 'no recovery data',
    });
  } catch (err) {
    sources.push({ key: 'readiness', status: 'failed', detail: errMsg(err) });
  }

  // ── Calendar ───────────────────────────────────────────────────────────
  const calendar: DaydreamSnapshot['calendar'] = {
    events: [],
    partial: false,
    available: false,
  };
  try {
    const { executeTool } = await import('$lib/workflows/site-tools/registry');
    const res = await executeTool('apple_calendar_list', {
      dateRangeStart: 'today',
      dateRangeEnd: '+1d',
    });
    const data = res?.data as
      | { events?: unknown[]; unavailable?: unknown[] }
      | undefined;
    if (res?.success && data) {
      calendar.available = true;
      // `unavailable` means at least one calendar could not be read. A partial
      // diary must NEVER be treated as an empty one — that is how "your
      // afternoon is free" gets said over the top of a meeting.
      calendar.partial = Array.isArray(data.unavailable) && data.unavailable.length > 0;
      calendar.events = (Array.isArray(data.events) ? data.events : [])
        .map((e) => {
          const ev = e as Record<string, unknown>;
          const start = typeof ev.start === 'string' ? new Date(ev.start) : null;
          if (!start || Number.isNaN(start.getTime())) return null;
          return {
            title: typeof ev.title === 'string' ? ev.title : '(untitled)',
            start,
            end: typeof ev.end === 'string' ? new Date(ev.end) : null,
            location: typeof ev.location === 'string' ? ev.location : null,
          } satisfies CalendarEvent;
        })
        .filter((e): e is CalendarEvent => e !== null);
    }
    sources.push({
      key: 'calendar',
      status: calendar.available ? (calendar.partial ? 'unavailable' : 'ok') : 'failed',
      detail: calendar.partial
        ? 'partial read — treated as unknown, not empty'
        : `${calendar.events.length} events`,
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
  try {
    memories = await db
      .select({ id: jkaiMemories.id, category: jkaiMemories.category, content: jkaiMemories.content })
      .from(jkaiMemories)
      .where(sql`${jkaiMemories.supersededBy} is null`)
      .limit(200);
    sources.push({ key: 'memories', status: memories.length ? 'ok' : 'empty', detail: `${memories.length} live` });
  } catch (err) {
    sources.push({ key: 'memories', status: 'failed', detail: errMsg(err) });
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
    sources,
  };
}
