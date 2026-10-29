// src/lib/daydream/think/situation.server.ts
//
// Gathering "Right now" (`situation.ts`). Every read is soft: one that fails
// says "unknown" on the card and costs the cycle nothing.

import { and, asc, gte, inArray, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { trip } from '$lib/db/schema';
import { DEFAULT_SUBJECT } from '../types';
import { localDay } from '../features/build';
import { renderSituation, type PersonNow, type SituationInputs } from './situation';

const soft = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null;
  }
};

async function household(): Promise<{ me: PersonNow | null; others: PersonNow[] } | null> {
  const [{ loadHousehold }, { listMembers }, { nowStatus }] = await Promise.all([
    import('$lib/home/presence/household'),
    import('$lib/home/presence/members'),
    import('$lib/home/presence/now'),
  ]);
  const [{ members }, roster] = await Promise.all([loadHousehold(), listMembers()]);
  const names = new Map(roster.map((m) => [m.subject, m.displayName]));
  const people = members.map((m) => ({
    subject: m.subject,
    person: {
      name: names.get(m.subject) ?? m.subject,
      status: nowStatus(m),
      // A person not sharing shows no place, whatever the trail holds.
      place: m.notSharing ? null : m.placeLabel,
      distanceKm: m.notSharing ? null : m.distanceHomeKm,
      ageMins: m.notSharing ? null : m.ageMins,
    } satisfies PersonNow,
  }));
  return {
    me: people.find((p) => p.subject === DEFAULT_SUBJECT)?.person ?? null,
    others: people.filter((p) => p.subject !== DEFAULT_SUBJECT).map((p) => p.person),
  };
}

async function currentTrip(today: string): Promise<SituationInputs['trip']> {
  const horizon = localDay(new Date(Date.parse(`${today}T12:00:00Z`) + 14 * 86_400_000));
  const rows = await db
    .select({ title: trip.title, destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate })
    .from(trip)
    .where(and(inArray(trip.status, ['planned', 'active']), gte(trip.endDate, today), lte(trip.startDate, horizon)))
    .orderBy(asc(trip.startDate))
    .limit(1);
  const t = rows[0];
  if (!t) return null;
  return { ...t, today: t.startDate <= today && today <= t.endDate };
}

async function bodyNumbers(now: Date) {
  const { seriesDays } = await import('$lib/owner-data/health.server');
  const today = localDay(now);
  const [sleep, recovery, hrv, mood] = await Promise.all([
    soft(seriesDays('sleep_hours', 3, now)),
    soft(seriesDays('recovery', 3, now)),
    soft(seriesDays('hrv', 30, now)),
    soft(seriesDays('mood', 14, now)),
  ]);
  const last = <T extends { day: string }>(xs: T[] | null | undefined) => (xs?.length ? xs[xs.length - 1] : null);
  const fresh = (d: { day: string } | null) => !!d && d.day >= localDay(new Date(now.getTime() - 86_400_000)) && d.day <= today;
  const s = last(sleep);
  const r = last(recovery);
  const h = last(hrv);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const usual = avg((hrv ?? []).slice(0, -1).map((d) => d.value));
  const m = last(mood);
  const weekFloor = localDay(new Date(now.getTime() - 7 * 86_400_000));
  const week = avg((mood ?? []).filter((d) => d.day > weekFloor).map((d) => d.value));
  const before = avg((mood ?? []).filter((d) => d.day <= weekFloor).map((d) => d.value));
  return {
    sleepLastNight: fresh(s) ? s!.value : null,
    recoveryToday: fresh(r) ? r!.value : null,
    hrv: fresh(h) && usual != null ? { today: h!.value, usual } : null,
    mood: m ? { latest: m.value, latestDay: m.day, week, before } : null,
  };
}

export async function loadSituationInputs(now = new Date()): Promise<SituationInputs> {
  const today = localDay(now);
  const localTime = now.toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const [people, tripNow, nums, body, diary] = await Promise.all([
    soft(household()),
    soft(currentTrip(today)),
    soft(bodyNumbers(now)),
    soft(import('$lib/owner-data/health.server').then((h) => h.healthHubTool({ sections: ['read'] }))),
    soft(import('$lib/owner-data/diary.server').then((d) => d.diaryTool({ from: 'today', to: '+1d' }))),
  ]);
  return {
    localTime,
    me: people?.me ?? null,
    others: people?.others ?? [],
    trip: tripNow,
    body: body ? body.split('\n').slice(1).join(' ') : null,
    sleepLastNight: nums?.sleepLastNight ?? null,
    recoveryToday: nums?.recoveryToday ?? null,
    hrv: nums?.hrv ?? null,
    mood: nums?.mood ?? null,
    diary,
  };
}

export async function situationCard(now = new Date()): Promise<string> {
  return renderSituation(await loadSituationInputs(now));
}
