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
// other days are made when the page is viewed or the phone reads its bundle
// (`bundleGuidance`). A stop guide is remade when its wish's facts are newer,
// and the city guide when it is a month old and the trip is ten days off. Leg guidance is cached per
// trip in `app_settings` by (date, mode, from, to), so a re-solve that keeps a
// leg keeps its guidance, and the plan is decorated with it when read. No
// figure here comes from Mapbox (D1).

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { appSettings } from '$lib/db/schema';
import {
  decoratePlan,
  guidanceDates,
  guidanceDue,
  stopGuideNeeded,
  tripGuideNeeded,
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
  PRIMER_SYSTEM,
  primerNeeded,
  readPrimer,
  type GuidanceCache,
} from './guidance';
import { jsonCall } from './llm.server';
import type { LatLng, LegGuidance, LocalDate, SolvedPlan, TravelMode, TripGuide, Wish } from './model';
import { legDepartIso, localDateIn } from './routing';
import { getTrip, latestPlan, loadState, setStopGuide, setTripGuide, type TripRecord } from './store.server';

const USER_AGENT = 'StrangeRamblingsTrips/1.0 (+https://strangeramblings.com)';
const TIMEOUT_MS = 12_000;
/** Legs routed per day (each may be a Transitous or ORS request). */
const LEGS_PER_DAY = 20;

const cacheKey = (tripId: string) => `trips.guidance.${tripId}`;
/** Trips with a guidance run under way in this process. */
const running = new Set<string>();

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

/** A bundle read starts a run at most this often per trip (a run that cannot finish — no model — is not retried on every refresh). */
const BUNDLE_RUN_GAP_MS = 10 * 60_000;
const bundleRuns = new Map<string, number>();

/**
 * The plan with its guidance for the phone's bundle — and, when a day from
 * today on still lacks leg guidance or a stop guide (or the city guide is
 * due), a background run for those days, so days 3+ have directions before
 * the trip. Never waits for the run.
 */
export async function bundleGuidance(trip: TripRecord, plan: SolvedPlan, wishes: Wish[], now: Date = new Date()): Promise<SolvedPlan> {
  const cache = await readGuidance(trip.id);
  const today = localDateIn(trip.timeZone, now);
  const due = guidanceDue(plan, cache, wishes, today);
  const last = bundleRuns.get(trip.id) ?? 0;
  if ((due.length || tripGuideNeeded(trip, today, now) || primerNeeded(trip.guide)) && now.getTime() - last >= BUNDLE_RUN_GAP_MS && !running.has(trip.id)) {
    bundleRuns.set(trip.id, now.getTime());
    startGuidance(trip.ownerEmail, trip.id, due);
  }
  return decoratePlan(plan, cache);
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
  return legDepartIso(date, departMin, localDateIn(trip.timeZone, new Date()), trip.timeZone);
}

// ── The trip guide ─────────────────────────────────────────────────────────

/** Make the city guide once. Without search it is written from the model alone, with no links; without a model, none. */
/**
 * v7: the city primer and the trip's neighbourhoods, onto a guide that has
 * none — one search ("visiting <city>: etiquette, tipping, phrases, safety")
 * and one reader call. A failure leaves the guide as it was.
 */
export async function ensurePrimer(trip: TripRecord, guide: TripGuide | null): Promise<TripGuide | null> {
  if (!guide || !primerNeeded(guide)) return guide;
  let results: Array<{ title: string; url: string; content: string }> = [];
  try {
    const { search } = await import('$lib/deepdive/tavily');
    const found = await search(`visiting ${trip.destination}: etiquette, tipping, cash or card, useful phrases, safety for tourists`, { purpose: 'trips.guide', maxResults: 6, searchDepth: 'basic' });
    results = (found.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content ?? '' }));
  } catch (err) {
    console.warn('[trips/guidance] primer search unavailable:', (err as Error)?.message);
  }
  const { wishes } = await loadState(trip.id);
  const places = wishes.filter((w) => !w.skipped && !w.suggested && w.place).map((w) => `${w.title}${w.place?.address ? ` — ${w.place.address}` : ''}`);
  const titles = wishes.filter((w) => !w.skipped && !w.suggested && w.place).map((w) => w.title);
  try {
    const raw = await jsonCall(
      'trips-reader',
      [
        { role: 'system', content: PRIMER_SYSTEM },
        {
          role: 'user',
          content: `City: ${trip.destination}\n\nThe trip's places:\n${places.length ? places.map((p) => `- ${p}`).join('\n') : '(none yet)'}\n\nSearch results:\n${results.length ? results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 1200)}`).join('\n\n') : '(none — the search was unavailable; keep to widely known, stable facts)'}`,
        },
      ],
      { maxTokens: 1400, temperature: 0 },
    );
    const { primer, neighbourhoods } = readPrimer(raw, results, titles);
    if (!primer && !neighbourhoods.length) {
      // Nothing usable: say when it was tried, so the next try waits a day.
      const tried: TripGuide = { ...guide, primerTriedAt: new Date().toISOString() };
      await setTripGuide(trip.id, tried);
      return tried;
    }
    const next: TripGuide = { ...guide, primer, neighbourhoods };
    await setTripGuide(trip.id, next);
    return next;
  } catch (err) {
    console.warn('[trips/guidance] no model for the primer:', (err as Error)?.message);
    const tried: TripGuide = { ...guide, primerTriedAt: new Date().toISOString() };
    await setTripGuide(trip.id, tried).catch(() => {});
    return tried;
  }
}

export async function ensureTripGuide(trip: TripRecord): Promise<TripRecord['guide']> {
  if (!tripGuideNeeded(trip, localDateIn(trip.timeZone, new Date()))) return ensurePrimer(trip, trip.guide);
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
    const fresh = readTripGuide(raw, results, new Date().toISOString());
    // A refresh keeps the primer it had; one that came back empty keeps the guide there was.
    const guide = fresh ? { ...fresh, primer: trip.guide?.primer ?? null, neighbourhoods: trip.guide?.neighbourhoods ?? [] } : null;
    if (guide) await setTripGuide(trip.id, guide);
    return ensurePrimer(trip, guide ?? trip.guide);
  } catch (err) {
    console.warn('[trips/guidance] no model for the city guide:', (err as Error)?.message);
    return trip.guide;
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
      // None yet, or facts checked since it was written (./guidance `stopGuideNeeded`).
      .filter((w): w is NonNullable<typeof w> => !!w && stopGuideNeeded(w) && !done.has(w.id));
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
      if (tripGuideNeeded(trip, localDateIn(trip.timeZone, new Date())) || primerNeeded(trip.guide)) {
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
