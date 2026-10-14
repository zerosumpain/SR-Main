// src/lib/trips/guidance.server.ts
//
// Making guidance (v2), the I/O half of ./guidance:
//
//   TripGuide   once per trip — one web search ("getting around <city>: taxis,
//               public transport tickets") + one `trips-reader` call.
//   StopGuide   per planned wish, from its facts + one `trips-reader` call.
//   LegGuidance per leg: routed facts first (openrouteservice walking
//               instructions, else Transitous walking steps; Transitous lines,
//               stops and departures; taxi know-how from the TripGuide), then
//               one `trips-reader` call per day for the words.
//
// After each solve this runs in the background for today and the next day;
// other days are made when the page is viewed. Leg guidance is cached per
// trip in `app_settings` by (date, mode, from, to), so a re-solve that keeps a
// leg keeps its guidance, and the plan is decorated with it when read. No
// figure here comes from Mapbox (D1).

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import {
  decoratePlan,
  guidanceDates,
  legsLacking,
  LEG_GUIDE_SYSTEM,
  readLegWords,
  readStopGuides,
  readTripGuide,
  guidanceOrder,
  routerGuidance,
  stepsFromMotis,
  stepsFromOrs,
  STOP_GUIDES_SYSTEM,
  stopGuidePrompt,
  transitFromMotis,
  TRIP_GUIDE_SYSTEM,
  type GuidanceCache,
} from './guidance';
import { jsonCall } from './llm.server';
import type { LatLng, LegGuidance, LocalDate, SolvedPlan, TravelMode } from './model';
import { localDateIn, localToIso, timetableDate } from './routing';
import { getTrip, latestPlan, loadState, setStopGuide, setTripGuide, type TripRecord } from './store.server';

const USER_AGENT = 'StrangeRamblingsTrips/1.0 (+https://strangeramblings.com)';
const TIMEOUT_MS = 12_000;
/** Legs routed per day (each may be a Transitous or ORS request). */
const LEGS_PER_DAY = 20;

const cacheKey = (tripId: string) => `trips.guidance.${tripId}`;

export async function readGuidance(tripId: string): Promise<GuidanceCache> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, cacheKey(tripId)));
    return ((row?.value as GuidanceCache | undefined) ?? {}) as GuidanceCache;
  } catch {
    return {};
  }
}

async function writeGuidance(tripId: string, cache: GuidanceCache): Promise<void> {
  // Keep the newest 400 legs: a long trip re-solved many times does not grow without bound.
  const kept = Object.fromEntries(
    Object.entries(cache)
      .sort((a, b) => (a[1].generatedAt < b[1].generatedAt ? 1 : -1))
      .slice(0, 400),
  );
  await db
    .insert(appSettings)
    .values({ key: cacheKey(tripId), value: kept })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: kept, updatedAt: new Date() } });
}

export async function deleteGuidance(tripId: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, cacheKey(tripId)));
}

/** The plan with its guidance, for the page and the phone. */
export async function withGuidance(tripId: string, plan: SolvedPlan): Promise<SolvedPlan> {
  return decoratePlan(plan, await readGuidance(tripId));
}

// ── Routed facts for one leg ───────────────────────────────────────────────

async function orsSteps(mode: TravelMode, a: LatLng, b: LatLng): Promise<string[] | null> {
  const profile = mode === 'cycle' ? 'cycling-regular' : 'foot-walking';
  const url = `https://api.openrouteservice.org/v2/directions/${profile}/json`;
  let headers: Record<string, string> | null = null;
  try {
    const { resolveSecretForUrl } = await import('$lib/secrets/registry');
    headers = (await resolveSecretForUrl('openrouteservice', url, 'POST')).headers ?? null;
  } catch {
    headers = process.env.ORS_API_KEY ? { Authorization: process.env.ORS_API_KEY } : null;
  }
  if (!headers) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[a.lng, a.lat], [b.lng, b.lat]], instructions: true, language: 'en' }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { routes?: Array<{ segments?: unknown }> };
    const steps = stepsFromOrs(data.routes?.[0]?.segments);
    return steps.length ? steps : null;
  } catch {
    return null;
  }
}

let motisChain = Promise.resolve();
/** One Transitous plan request (serialised, lightly — their usage policy). */
async function motis(params: Record<string, string>): Promise<{ itineraries?: unknown[]; direct?: Array<{ legs?: Array<{ steps?: unknown }> }> } | null> {
  const run = async () => {
    const url = new URL('https://api.transitous.org/api/v1/plan');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      return res.ok ? ((await res.json()) as Awaited<ReturnType<typeof motis>>) : null;
    } catch {
      return null;
    }
  };
  const slot = motisChain.then(run);
  motisChain = slot.then(() => new Promise((r) => setTimeout(r, 300)));
  return slot;
}

/** When to ask a timetable about a leg: its own date and time if near, else the same weekday next week. */
function departIso(trip: TripRecord, date: LocalDate, departMin: number): string {
  const today = localDateIn(trip.timeZone, new Date());
  const ask = timetableDate(date, today);
  return localToIso(ask, departMin, trip.timeZone);
}

// ── The trip guide ─────────────────────────────────────────────────────────

/** Make the city guide once. Without search it is written from the model alone, with no links; without a model, none. */
export async function ensureTripGuide(trip: TripRecord): Promise<TripRecord['guide']> {
  if (trip.guide) return trip.guide;
  let results: Array<{ title: string; url: string; content: string }> = [];
  try {
    const { search } = await import('$lib/deepdive/tavily');
    const found = await search(`getting around ${trip.destination}: taxis, public transport tickets`, { purpose: 'trips.guide', maxResults: 6, searchDepth: 'basic' });
    results = (found.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content ?? '' }));
  } catch (err) {
    console.warn('[trips/guidance] city search unavailable:', (err as Error)?.message);
  }
  try {
    const raw = await jsonCall(
      'trips-reader',
      [
        { role: 'system', content: TRIP_GUIDE_SYSTEM },
        {
          role: 'user',
          content: `City: ${trip.destination}\n\nSearch results:\n${results.length ? results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 1200)}`).join('\n\n') : '(none — the search was unavailable; give no links or phone numbers)'}`,
        },
      ],
      { maxTokens: 1200, temperature: 0 },
    );
    const guide = readTripGuide(raw, results, new Date().toISOString());
    if (guide) await setTripGuide(trip.id, guide);
    return guide;
  } catch (err) {
    console.warn('[trips/guidance] no model for the city guide:', (err as Error)?.message);
    return null;
  }
}

// ── Leg guidance for some days ─────────────────────────────────────────────

export async function ensureLegGuidance(trip: TripRecord, plan: SolvedPlan, dates: LocalDate[]): Promise<number> {
  const cache = await readGuidance(trip.id);
  const lacking = legsLacking(plan, dates, cache).slice(0, LEGS_PER_DAY * Math.max(1, dates.length));
  if (!lacking.length) return 0;
  const now = new Date().toISOString();
  const byDay = new Map<LocalDate, Array<{ key: string; g: LegGuidance }>>();

  for (const item of lacking) {
    const { day, leg, from, to } = item;
    const toStop = day.stops.find((s) => s.id === leg.toStopId);
    const fromStop = day.stops.find((s) => s.id === leg.fromStopId);
    const toTitle = toStop?.title ?? 'the next stop';
    let steps: string[] = [];
    let transit: LegGuidance['transit'] = null;
    if (leg.mode === 'walk' || leg.mode === 'cycle') {
      steps = (await orsSteps(leg.mode, from, to)) ?? [];
      if (!steps.length && leg.mode === 'walk') {
        const d = await motis({ fromPlace: `${from.lat},${from.lng}`, toPlace: `${to.lat},${to.lng}`, time: departIso(trip, day.date, fromStop?.departMin ?? 600), numItineraries: '1', directModes: 'WALK' });
        steps = stepsFromMotis(d?.direct?.[0]?.legs?.[0]?.steps);
      }
    } else if (leg.mode === 'transit') {
      const d = await motis({ fromPlace: `${from.lat},${from.lng}`, toPlace: `${to.lat},${to.lng}`, time: departIso(trip, day.date, fromStop?.departMin ?? 600), numItineraries: '4' });
      const t = transitFromMotis(d?.itineraries, trip.timeZone);
      if (t) {
        transit = t.transit;
        steps = t.walkSteps;
      }
    }
    const g = routerGuidance({ leg, toTitle, steps, transit, tripGuide: trip.guide, now });
    const list = byDay.get(day.date) ?? [];
    list.push({ key: item.key, g });
    byDay.set(day.date, list);
  }

  // One call per day for the words; without a model the router text stands.
  for (const [date, items] of byDay) {
    let polished = items.map((x) => x.g);
    try {
      const raw = await jsonCall(
        'trips-reader',
        [
          { role: 'system', content: LEG_GUIDE_SYSTEM },
          {
            role: 'user',
            content: JSON.stringify({
              city: trip.destination,
              date,
              cityGuide: trip.guide ? { gettingAround: trip.guide.gettingAround, transitTickets: trip.guide.transitTickets } : null,
              legs: items.map((x, i) => ({ i, summary: x.g.summary, steps: x.g.steps, transit: x.g.transit, taxi: x.g.booking?.how ?? null })),
            }),
          },
        ],
        { maxTokens: 1800, temperature: 0 },
      );
      polished = readLegWords(raw, polished);
    } catch (err) {
      console.warn('[trips/guidance] leg words unavailable, router text kept:', (err as Error)?.message);
    }
    items.forEach((x, i) => (cache[x.key] = polished[i]));
    // Written day by day, so the first days show while later ones are made.
    await writeGuidance(trip.id, cache);
  }
  return lacking.length;
}

// ── Stop guides ────────────────────────────────────────────────────────────

/** Stop guides for the planned places of some days: ONE model call per day. */
export async function ensureStopGuides(trip: TripRecord, plan: SolvedPlan, dates: LocalDate[]): Promise<number> {
  const { wishes } = await loadState(trip.id);
  const byId = new Map(wishes.map((w) => [w.id, w]));
  const done = new Set<string>();
  let made = 0;
  for (const date of dates) {
    const day = plan.days.find((d) => d.date === date);
    const todo = (day?.stops ?? [])
      .map((s) => (s.wishId ? byId.get(s.wishId) : undefined))
      .filter((w): w is NonNullable<typeof w> => !!w && !w.guide && !done.has(w.id));
    if (!todo.length) continue;
    todo.forEach((w) => done.add(w.id));
    try {
      const raw = await jsonCall(
        'trips-reader',
        [
          { role: 'system', content: STOP_GUIDES_SYSTEM },
          { role: 'user', content: todo.map((w, i) => `[${i}] ${stopGuidePrompt(w.title, w.place?.name ?? null, trip.destination, w.facts)}`).join('\n\n') },
        ],
        { maxTokens: 400 + 350 * todo.length, temperature: 0 },
      );
      const guides = readStopGuides(raw, todo.map((w) => w.facts), new Date().toISOString());
      for (const [i, g] of guides.entries()) {
        if (!g) continue;
        await setStopGuide(trip.id, todo[i].id, g);
        made++;
      }
    } catch (err) {
      console.warn('[trips/guidance] no model for stop guides:', (err as Error)?.message);
      break; // no model: do not try the other days
    }
  }
  return made;
}

// ── The background run ─────────────────────────────────────────────────────

const running = new Set<string>();

/**
 * Guidance for a trip in the background, never awaited by a request: the city
 * guide, then for each day (today and the next first) its legs and its
 * stops. One run per trip at a time; a second request while one runs is
 * dropped — the next page view or solve picks up what is still missing.
 */
export function startGuidance(owner: string, tripId: string, dates: LocalDate[] | 'next-two' | 'all' = 'next-two'): void {
  if (running.has(tripId)) return;
  running.add(tripId);
  void (async () => {
    try {
      let trip = await getTrip(owner, tripId);
      const latest = await latestPlan(tripId);
      if (!trip || !latest) return;
      if (!trip.guide) {
        await ensureTripGuide(trip);
        trip = (await getTrip(owner, tripId)) ?? trip;
      }
      const today = localDateIn(trip.timeZone, new Date());
      const wanted =
        dates === 'all' ? guidanceOrder(latest.plan, today) : dates === 'next-two' ? guidanceDates(latest.plan, today) : dates;
      // Day by day, next two first: each day's legs (routing + one call),
      // then its stops (one call), so the days people need soonest are ready first.
      for (const date of wanted) {
        await ensureLegGuidance(trip, latest.plan, [date]);
        await ensureStopGuides(trip, latest.plan, [date]);
      }
    } catch (err) {
      console.warn('[trips/guidance] run failed:', (err as Error)?.message);
    } finally {
      running.delete(tripId);
    }
  })();
}
