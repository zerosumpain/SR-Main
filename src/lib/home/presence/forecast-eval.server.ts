// src/lib/home/presence/forecast-eval.server.ts
//
// The nightly scorecard: the last SCORE_DAYS days of real trips replayed
// through the forecast (`forecast-eval.ts`), kept in app_settings with a short
// history so /home/people can say whether the forecast is getting better.
// Owner-scoped like the trail it reads: it scores everyone who shares.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/server/models/settings';
import { localClock } from './forecast';
import { forecastCorrections, homePlaceIds } from './forecast.server';
import { scoreForecast, type Scorecard } from './forecast-eval';
import { normaliseReadings, tripsFrom } from './insights';
import { insightMembers, trailRows } from './insights.server';

export const SCORECARD_KEY = 'home.forecast.scorecard';
/** Days scored; the forecast learns 28 days before each, so the read is their sum. */
export const SCORE_DAYS = 28;
const LEARN_DAYS = 28;
/** Nights of headline numbers kept for the trend. */
const HISTORY_KEPT = 60;

export interface ScorecardNight {
  date: string;
  precision: number | null;
  recall: number | null;
  band: number | null;
  p80: number | null;
  etaWindow: number | null;
  overdueFired: number;
  overdueSkipped: number;
}

export interface StoredScorecard {
  latest: Scorecard;
  history: ScorecardNight[];
}

export const loadScorecard = () => getSetting<StoredScorecard>(SCORECARD_KEY).catch(() => null);

/** Score the forecast over the days before `now` and keep it. */
export async function runScorecard(now = new Date()): Promise<Scorecard | null> {
  const people = (await insightMembers({ kind: 'owner' })).map((m) => ({ subject: m.subject, displayName: m.displayName }));
  if (!people.length) return null;
  const days = SCORE_DAYS + LEARN_DAYS + 1;
  const [rows, places, homeIds, corrections] = await Promise.all([
    trailRows(`scorecard:${+now}`, people.map((p) => p.subject), days, now),
    db.select().from(daydreamPlaces).where(eq(daydreamPlaces.status, 'active')),
    homePlaceIds(),
    forecastCorrections(days, now),
  ]);
  const fixes = normaliseReadings(rows);
  const trips = people.flatMap((p) => tripsFrom(fixes.filter((f) => f.subject === p.subject), places, now).trips);
  const to = localClock(+now - 86_400_000).date;
  const from = localClock(+now - SCORE_DAYS * 86_400_000).date;
  const card = scoreForecast({ trips, places, people, homeIds, from, to, learnDays: LEARN_DAYS, corrections }, now);
  const stored = await loadScorecard();
  const night: ScorecardNight = {
    date: localClock(now).date, precision: card.next.precision, recall: card.next.recall, band: card.duration.band,
    p80: card.duration.p80, etaWindow: card.eta.window, overdueFired: card.overdue.fired, overdueSkipped: card.overdue.skipped,
  };
  const history = [...(stored?.history ?? []).filter((n) => n.date !== night.date), night].slice(-HISTORY_KEPT);
  await setSetting(SCORECARD_KEY, { latest: card, history } satisfies StoredScorecard);
  return card;
}
