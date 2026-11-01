// src/lib/home/presence/patterns.server.ts
//
// The movement patterns report behind /home/people/patterns: ninety days of
// everyone's trail, the places, and each person's daily step count from the
// app, run through `analysePatterns` and kept in app_settings. Built nightly
// with the forecast (`forecast-nightly`) — seconds of CPU and a few hundred
// small pilot calls, so never on a page load. First, any place not yet
// looked up gets a web search for what it is (`place-types.server`), and each
// big place gets its map of cafés and shops (`venues.server`). Owner-only: the page refuses
// anyone else, and so does the rebuild.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { pilotSteps } from './companion-accounts';
import { localClock } from './forecast';
import { insightMembers, trailRows } from './insights.server';
import { getHomePlace } from './places';
import { analysePatterns, findingsOf, placeQuery, type PatternPlace, type PatternsReport } from './patterns';
import {
  dominantSources, EMPTY_HISTORY, historyView, mergeMonth, monthsTouching, summariseMonth, type PatternsHistory,
} from './patterns-history';
import { loadPlaceTypes, refreshPlaceTypes } from './place-types.server';
import { attachVenues } from './venues.server';

export const PATTERNS_KEY = 'home.patterns.report';
/** Month by month, kept for good: never pruned, never overwritten by less (`mergeMonth`). */
export const HISTORY_KEY = 'home.patterns.history';
export const PATTERNS_DAYS = 90;
/** The pilot refuses a steps window over two days. */
const STEP_WINDOW_DAYS = 2;

export const loadPatterns = () => getSetting<PatternsReport>(PATTERNS_KEY).catch(() => null);
export const loadHistory = async (): Promise<PatternsHistory> =>
  (await getSetting<PatternsHistory>(HISTORY_KEY).catch(() => null)) ?? EMPTY_HISTORY;

/**
 * One person's daily steps over the window, by local date. The pilot keeps one
 * cumulative record per local day starting at its midnight: pick, never sum.
 * Null: no app account. A window that fails is a few days missing, not none.
 */
export async function dailySteps(email: string, days: number, now: Date): Promise<Map<string, number> | null> {
  const out = new Map<string, number>();
  const end = Math.floor(+now / 1000);
  for (let from = end - days * 86_400; from < end; from += STEP_WINDOW_DAYS * 86_400) {
    const r = await pilotSteps(email, { from, to: Math.min(end, from + STEP_WINDOW_DAYS * 86_400), tz: 0 });
    if (!r.ok) {
      if (r.reason === 'not-found') return null;
      continue;
    }
    for (const rec of r.value.steps) {
      const at = Date.parse(rec.start);
      if (!Number.isFinite(at) || !Number.isFinite(rec.value) || rec.value < 0) continue;
      // A minute in: the record starts on local midnight, exactly.
      const date = localClock(at + 60_000).date;
      out.set(date, Math.max(out.get(date) ?? 0, Math.round(rec.value)));
    }
  }
  return out;
}

/**
 * `lookups`: how many batches of place lookups to run first; 0 uses only the
 * cache. `venueFetches`: how many big places' maps to fetch; 0 uses only those kept.
 * `months`: also sum each calendar month in the window into the kept history
 * (the nightly build does; the owner's Rebuild now reads what is kept).
 */
export async function runPatterns(now = new Date(), lookups = 20, venueFetches = 6, months = true): Promise<PatternsReport> {
  const [members, home] = await Promise.all([insightMembers({ kind: 'owner' }), getHomePlace().catch(() => null)]);
  const placeRows = await db.select().from(daydreamPlaces).where(eq(daydreamPlaces.status, 'active'));
  const places: Array<PatternPlace & { suggestedAddress: string | null }> = placeRows.map((p) => ({
    id: p.id, label: p.label, kind: p.kind, lat: p.lat, lon: p.lon, radiusM: p.radiusM, source: p.source,
    suggestedLabel: p.suggestedLabel, suggestedKind: p.suggestedKind, suggestedAddress: p.suggestedAddress, firstSeenAt: p.firstSeenAt,
  }));
  // A failed lookup costs the categories nothing they had: the cache still answers.
  const types = lookups > 0
    ? await refreshPlaceTypes(places, home?.id ?? null, lookups).then((r) => r.cache).catch(() => loadPlaceTypes())
    : await loadPlaceTypes();
  for (const p of places) {
    const t = types[p.id];
    // An answer for a name the place no longer has is stale.
    if (t && t.query === placeQuery(p, home?.id ?? null)) p.lookup = { category: t.category, type: t.type, name: t.name };
  }
  // The cafés and restaurants inside a big place, so a lunch in town is a food stop, not more "Town".
  await attachVenues(places, home?.id ?? null, now, venueFetches).catch(() => 0);
  const rows = members.length ? await trailRows('patterns', members.map((m) => m.subject), PATTERNS_DAYS, now) : [];
  const steps = new Map<string, Map<string, number>>();
  // One person at a time: the pilot is a small box and this is not urgent.
  for (const m of members) {
    if (!m.email) continue;
    const s = await dailySteps(m.email, PATTERNS_DAYS, now).catch(() => null);
    if (s?.size) steps.set(m.subject, s);
  }
  const people = members.map((m) => ({ subject: m.subject, displayName: m.displayName }));
  const report = await analysePatterns(rows, places, people, steps, now, PATTERNS_DAYS, home?.id ?? null);
  let history = await loadHistory();
  if (months) {
    // Each month alone, through the same analysis: the same day four times
    // over is still seconds of CPU, once a night.
    const windowFrom = +now - PATTERNS_DAYS * 86_400_000;
    for (const m of monthsTouching(windowFrom, +now)) {
      const from = Math.max(m.start, windowFrom), to = Math.min(m.end, +now);
      if (to - from < 86_400_000) continue;
      const inMonth = rows.filter((r) => +r.ts >= from && +r.ts < to);
      const monthly = await analysePatterns(inMonth, places, people, steps, new Date(to), (to - from) / 86_400_000, home?.id ?? null);
      history = mergeMonth(history, summariseMonth(monthly, m, +now, windowFrom, dominantSources(inMonth)));
    }
    await setSetting(HISTORY_KEY, history);
  }
  report.history = historyView(history);
  const names = new Map(people.map((p) => [p.subject, p.displayName]));
  report.findings = findingsOf(report, (s) => names.get(s) ?? s);
  await setSetting(PATTERNS_KEY, report);
  return report;
}
