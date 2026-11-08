// The reads behind `GET /api/platform/briefing/context`. The rules are in
// ./context (PURE); this file asks the trips and family stores for their rows.
//
// Never throws for missing data: each block fails on its own — a trip read
// that fails is `trip: null`, an unreadable family table is `family: null`.

import { isOwnerEmail } from '$lib/server/access';
import { latestPlan, listAllTrips, listTransport, loadState } from '$lib/trips/store.server';
import type { TripSummary } from '$lib/trips/bundle';
import { localDateIn } from '$lib/trips/routing';
import { familyRoster, nameFromEmail } from '$lib/family/roster.server';
import { recentMessages } from '$lib/family/messages.server';
import { loadTasks } from '$lib/family/tasks.server';
import {
  firstName,
  openTasks,
  orderTransports,
  pickNextTrip,
  pickTodayTrip,
  safeTimeZone,
  stayForDay,
  stopsForDay,
  summariseMessages,
  toBriefingTransport,
  tripDay,
  tripsCovering,
  type BriefingContext,
  type FamilyBlock,
  type TripToday,
} from './context';

type Candidate = TripSummary & { transportCount?: number };

async function tripToday(t: TripSummary, today: string, active: boolean): Promise<TripToday> {
  const [transport, state, plan] = await Promise.all([
    listTransport(t.id).catch(() => []),
    loadState(t.id).catch(() => ({ stays: [] })),
    active ? latestPlan(t.id).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    id: t.id,
    title: t.title,
    destination: t.destination,
    timeZone: t.timeZone,
    startDate: t.startDate,
    endDate: t.endDate,
    ...tripDay(t.startDate, t.endDate, today),
    stay: stayForDay(state.stays, today),
    todayStops: active ? stopsForDay(plan?.plan, today) : [],
    transports: orderTransports(transport.map((s) => toBriefingTransport(s))),
  };
}

async function loadTrips(today: string): Promise<Pick<BriefingContext, 'trip' | 'nextTrip'>> {
  const all: Candidate[] = await listAllTrips();
  // Journeys break a tie between overlapping trips; count them only for those.
  const covering = tripsCovering(all, today);
  if (covering.length > 1) {
    await Promise.all(
      covering.map(async (t) => {
        t.transportCount = (await listTransport(t.id).catch(() => [])).length;
      }),
    );
  }
  const current = pickTodayTrip(all, today);
  if (current) return { trip: await tripToday(current, today, true), nextTrip: null };
  const next = pickNextTrip(all, today);
  return { trip: null, nextTrip: next ? await tripToday(next, today, false) : null };
}

async function loadFamily(now: Date): Promise<FamilyBlock> {
  const [roster, messages, tasks] = await Promise.all([
    familyRoster().catch(() => []),
    recentMessages(now),
    loadTasks(now),
  ]);
  const names = new Map(roster.map((p) => [p.email, p.name]));
  return {
    members: [...new Set(roster.filter((p) => !isOwnerEmail(p.email)).map((p) => firstName(p.name)).filter(Boolean))],
    ...summariseMessages(messages, isOwnerEmail, now),
    tasksOpen: openTasks(tasks, (email) => names.get(email.trim().toLowerCase()) ?? nameFromEmail(email)),
  };
}

export async function buildBriefingContext(now: Date, tz?: string | null): Promise<BriefingContext> {
  const today = localDateIn(safeTimeZone(tz), now);
  const [trips, family] = await Promise.all([
    loadTrips(today).catch((err) => {
      console.error('[briefing] context: trips unavailable', err);
      return { trip: null, nextTrip: null };
    }),
    loadFamily(now).catch((err) => {
      console.error('[briefing] context: family unavailable', err);
      return null;
    }),
  ]);
  return { generatedAt: now.toISOString(), ...trips, family };
}
