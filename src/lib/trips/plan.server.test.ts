import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlannedDay, SolvedPlan, Stay, TripEvent, Wish } from './model';
import { romeInput } from './solver/fixtures/rome';

// The store in memory: plan versions, events with the (trip, clientId) unique
// key, wishes. Routing answers with the fixture's estimated matrix (no I/O).
const h = vi.hoisted(() => ({
  plans: [] as Array<Record<string, any>>,
  events: new Map<string, TripEvent>(),
  wishes: [] as Wish[],
  stays: [] as Stay[],
  added: [] as unknown[],
  status: 'planned',
}));

vi.mock('./store.server', () => ({
  latestPlan: async () => h.plans.at(-1) ?? null,
  latestPhonePlan: async () => [...h.plans].reverse().find((p) => p.source === 'phone') ?? null,
  loadState: async () => ({ stays: h.stays, wishes: h.wishes, bookings: [] }),
  appendPlan: async (_t: string, p: Record<string, unknown>) => {
    const row = { id: `p${h.plans.length + 1}`, tripId: 't', version: h.plans.length + 1, createdAt: new Date().toISOString(), ...p };
    h.plans.push(row);
    return row;
  },
  recordEvents: async (_t: string, events: TripEvent[]) => {
    const fresh = new Set<string>();
    for (const e of events) if (!h.events.has(e.clientId)) {
      h.events.set(e.clientId, e);
      fresh.add(e.clientId);
    }
    return fresh;
  },
  setEventPlanVersion: async () => {},
  updateWish: async (_t: string, id: string, patch: Partial<Wish>) => {
    const w = h.wishes.find((x) => x.id === id);
    if (w) Object.assign(w, patch);
    return w ?? null;
  },
  addWishes: async (_t: string, list: unknown[]) => {
    h.added.push(...list);
    return [];
  },
  updateTrip: async (_t: string, p: { status?: string }) => {
    if (p.status) h.status = p.status;
  },
  tripOnly: (t: unknown) => t,
}));

vi.mock('./routing.server', async () => {
  const { estimateMatrix } = await import('./solver');
  return {
    buildStoredMatrix: async (points: Array<{ id: string; location: { lat: number; lng: number } }>, trip: { modes: never[] }) => ({
      matrix: estimateMatrix(points, trip.modes),
      notes: ['walk: estimated from distance'],
    }),
    attachLegLines: async (plan: SolvedPlan) => plan,
  };
});

const { applyEvents, replan, storePhoneDay, tripBundle } = await import('./plan.server');

function trip() {
  const t = romeInput().trip;
  return { ...t, id: 't', research: null, updatedAt: '2026-10-13T00:00:00Z', status: h.status } as any;
}

beforeEach(() => {
  const input = romeInput();
  h.plans = [];
  h.events = new Map();
  h.wishes = input.wishes;
  h.stays = input.stays;
  h.added = [];
  h.status = 'planned';
});

describe('replan', () => {
  it('stores version 1, then nothing when the constraints have not changed', async () => {
    const first = await replan(trip());
    expect(first).toMatchObject({ created: true, plan: { version: 1, source: 'site', changes: expect.arrayContaining(['First plan.']) } });
    expect(first.plan.plan.days).toHaveLength(4);
    const again = await replan(trip());
    expect(again).toMatchObject({ created: false, plan: { version: 1 } });
    h.wishes = h.wishes.filter((w) => w.id !== 'pantheon');
    const third = await replan(trip());
    expect(third).toMatchObject({ created: true, plan: { version: 2 } });
    expect(third.plan.changes.join(' ')).toContain('Pantheon is no longer planned');
  });
});

describe('the phone', () => {
  it('applies each event once, whatever the retries', async () => {
    await replan(trip());
    const day: PlannedDay = { ...(h.plans[0].plan as SolvedPlan).days[1] };
    day.stops = day.stops.filter((s) => s.wishId !== 'spanish-steps');
    const events: TripEvent[] = [
      { clientId: 'c1', kind: 'arrived', stopId: 'pantheon', wishId: 'pantheon', at: '2026-10-28T10:00:00Z', detail: null },
      { clientId: 'c2', kind: 'option-applied', stopId: null, wishId: null, at: '2026-10-28T10:05:00Z', detail: { option: 'o1', day } },
      { clientId: 'c3', kind: 'skipped', stopId: 'trevi', wishId: 'trevi', at: '2026-10-28T10:06:00Z', detail: null },
      { clientId: 'c4', kind: 'stop-added', stopId: null, wishId: null, at: '2026-10-28T19:00:00Z', detail: { title: 'Gelato', location: { lat: 41.9, lng: 12.47 } } },
    ];
    const first = await applyEvents(trip(), events);
    expect(first).toEqual({ accepted: ['c1', 'c2', 'c3', 'c4'], planVersion: 2 });
    expect(h.plans[1]).toMatchObject({ source: 'phone' });
    expect((h.plans[1].plan as SolvedPlan).days[1]).toEqual(day);
    expect((h.plans[1].plan as SolvedPlan).days[0]).toEqual((h.plans[0].plan as SolvedPlan).days[0]);
    expect(h.wishes.find((w) => w.id === 'trevi')?.skipped).toBe(true);
    expect(h.added).toEqual([expect.objectContaining({ title: 'Gelato', fixedDate: '2026-10-28', place: expect.objectContaining({ name: 'Gelato' }) })]);
    expect(h.status).toBe('active');

    const retry = await applyEvents(trip(), events);
    expect(retry).toEqual({ accepted: ['c1', 'c2', 'c3', 'c4'], planVersion: 2 });
    expect(h.plans).toHaveLength(2);
    expect(h.added).toHaveLength(1);
  });

  it('a phone day only replaces that day', async () => {
    await replan(trip());
    const before = h.plans[0].plan as SolvedPlan;
    const stored = await storePhoneDay(trip(), { ...before.days[2], warnings: ['phone'] });
    expect(stored?.plan.days.map((d) => d.warnings.includes('phone'))).toEqual([false, false, true, false]);
  });

  it('bundles per-day matrices of that day’s stops plus its stay, with a stable ETag', async () => {
    await replan(trip());
    const a = await tripBundle(trip());
    const b = await tripBundle(trip());
    expect(a.etag).toBe(b.etag);
    const day = a.plan!.plan.days[0];
    const m = a.matrices[day.date];
    expect(m.points[0]).toBe('stay:campo');
    expect(m.points.slice(1).sort()).toEqual(day.stops.filter((s) => s.kind === 'wish').map((s) => s.wishId).sort());
    expect(m.seconds.walk).toHaveLength(m.points.length);
  });
});
