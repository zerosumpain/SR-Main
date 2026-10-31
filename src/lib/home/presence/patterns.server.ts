// src/lib/home/presence/patterns.server.ts
//
// The movement patterns report behind /home/people/patterns: ninety days of
// everyone's trail, the places, and each person's daily step count from the
// app, run through `analysePatterns` and kept in app_settings. Built nightly
// with the forecast (`forecast-nightly`) — seconds of CPU and a few hundred
// small pilot calls, so never on a page load. First, any place not yet
// looked up gets a web search for what it is (`place-types.server`). Owner-only: the page refuses
// anyone else, and so does the rebuild.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { pilotSteps } from './companion-accounts';
import { localClock } from './forecast';
import { insightMembers, trailRows } from './insights.server';
import { getHomePlace } from './places';
import { analysePatterns, placeQuery, type PatternPlace, type PatternsReport } from './patterns';
import { loadPlaceTypes, refreshPlaceTypes } from './place-types.server';

export const PATTERNS_KEY = 'home.patterns.report';
export const PATTERNS_DAYS = 90;
/** The pilot refuses a steps window over two days. */
const STEP_WINDOW_DAYS = 2;

export const loadPatterns = () => getSetting<PatternsReport>(PATTERNS_KEY).catch(() => null);

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

/** `lookups`: how many batches of place lookups to run first; 0 uses only the cache. */
export async function runPatterns(now = new Date(), lookups = 20): Promise<PatternsReport> {
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
  const rows = members.length ? await trailRows('patterns', members.map((m) => m.subject), PATTERNS_DAYS, now) : [];
  const steps = new Map<string, Map<string, number>>();
  // One person at a time: the pilot is a small box and this is not urgent.
  for (const m of members) {
    if (!m.email) continue;
    const s = await dailySteps(m.email, PATTERNS_DAYS, now).catch(() => null);
    if (s?.size) steps.set(m.subject, s);
  }
  const report = await analysePatterns(rows, places, members.map((m) => ({ subject: m.subject, displayName: m.displayName })),
    steps, now, PATTERNS_DAYS, home?.id ?? null);
  await setSetting(PATTERNS_KEY, report);
  return report;
}
