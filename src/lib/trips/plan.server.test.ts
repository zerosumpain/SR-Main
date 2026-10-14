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
  messages: [] as unknown[],
  guidanceRuns: 0,
  model: null as null | ((messages: unknown[]) => unknown),
}));

vi.mock('./guidance.server', () => ({
  startGuidance: () => void h.guidanceRuns++,
  withGuidance: async (_t: string, plan: unknown) => plan,
}));
vi.mock('./llm.server', () => ({
  jsonCall: async (_w: string, messages: unknown[]) => {
    if (!h.model) throw new Error('no model');
    return h.model(messages);
  },
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
  tripOnly: (t: Record<string, unknown>) => {
    const { research: _r, updatedAt: _u, guide: _g, profile: _p, ...rest } = t;
    return rest;
  },
  listSuggestions: async () => [],
  suggestionWire: (s: Record<string, unknown>) => s,
  recentMessages: async () => h.messages,
  listTransport: async () => [],
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

const { applyEvents, fallbackNarrative, replan, storePhoneDay, storePhoneDays, tripBundle, tripReplan } = await import('./plan.server');

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
  h.messages = [];
  h.guidanceRuns = 0;
  h.model = null;
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

describe('stable re-plans', () => {
  it('passes the stored plan as previous, so a removed wish leaves the other days alone', async () => {
    await replan(trip());
    const dayOf = (p: SolvedPlan) => new Map(p.days.flatMap((d) => d.stops.filter((s) => s.wishId).map((s) => [s.wishId, d.date])));
    const first = dayOf(h.plans[0].plan as SolvedPlan);
    h.wishes = h.wishes.filter((w) => w.id !== 'spanish-steps');
    await replan(trip());
    const second = dayOf(h.plans[1].plan as SolvedPlan);
    const moved = [...second].filter(([id, date]) => first.get(id) !== date);
    expect(moved).toEqual([]);
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
    // v2: the whole-trip matrix, messages and guide travel too, under the ETag.
    expect(a.tripMatrix?.points.length).toBeGreaterThan(m.points.length);
    expect(a.messages).toEqual([]);
    h.messages = [{ id: 'm1', role: 'user', text: 'hi', ops: [], planVersion: null, surface: 'phone', createdAt: '2026-10-14T09:00:00Z' }];
    const c = await tripBundle(trip());
    expect(c.messages).toHaveLength(1);
    expect(c.etag).not.toBe(a.etag);
  });

  it('puts the travellers on the wire and never a memory — for anyone (v5)', async () => {
    await replan(trip());
    const profile = {
      travellers: [
        { name: 'You', relation: null, notes: ['NOTE-SECRET-1'], age: 44, personId: null },
        { name: 'Sam', relation: 'son', notes: ['NOTE-SECRET-2'], age: 9, personId: 'f_sam' },
      ],
      preferences: [{ text: 'PREF-SECRET walks everywhere', source: 'memory', ref: 'MEM-REF-1' }],
      constraints: [{ text: 'CONSTRAINT-SECRET no nuts', source: 'family', ref: 'MEM-REF-2' }],
      history: ['HISTORY-SECRET Paris 2024'],
      gatheredAt: '2026-10-13T00:00:00Z',
    };
    const b = await tripBundle({ ...trip(), profile }, { canEdit: false, canApprove: false, canSuggest: true, role: 'member' });
    expect(b.profile).toEqual({ travellers: [{ name: 'You', relation: null, age: 44, personId: null }, { name: 'Sam', relation: 'son', age: 9, personId: 'f_sam' }] });
    expect(b.access.role).toBe('member');
    const wire = JSON.stringify(b);
    for (const secret of ['SECRET', 'MEM-REF', 'preferences', 'constraints', 'history', 'gatheredAt', '"source"']) expect(wire).not.toContain(secret);
    // Every planned day has a fullness, and every leg its alternatives.
    const days = b.plan!.plan.days;
    expect(Object.keys(b.fullness).sort()).toEqual(days.map((d) => d.date).sort());
    for (const d of days) for (const leg of d.legs) expect(leg.alternatives?.map((a) => a.mode)).toEqual(['walk', 'transit', 'taxi']);
  });

  it('applies a whole-trip option (detail.days) as one phone version', async () => {
    await replan(trip());
    const before = h.plans[0].plan as SolvedPlan;
    const days = [
      { ...before.days[2], warnings: ['moved'] },
      { ...before.days[3], warnings: ['moved'], stops: [...before.days[3].stops, { ...before.days[3].stops[0], id: 'here:2026-10-30:700', wishId: null, kind: 'wish' as const, title: 'Bar del Fico' }] },
    ];
    const r = await applyEvents(trip(), [{ clientId: 't1', kind: 'option-applied', stopId: null, wishId: null, at: '2026-10-29T12:00:00Z', detail: { option: 'resolve-rest', days } }]);
    expect(r.planVersion).toBe(2);
    const stored = h.plans[1].plan as SolvedPlan;
    expect(stored.days.map((d) => d.warnings.includes('moved'))).toEqual([false, false, true, true]);
    expect(stored.days[3].stops.some((s) => s.id === 'here:2026-10-30:700')).toBe(true);
    expect(h.guidanceRuns).toBe(2);
    expect(await storePhoneDays(trip(), [])).toBeNull();
  });
});

describe('off the plan (v2)', () => {
  const body = {
    date: '2026-10-28', nowMin: 13 * 60, position: { lat: 41.8892, lng: 12.4703 }, atStopId: null, doneStopIds: [], scope: 'trip' as const,
    observation: { kind: 'unplanned-stop' as const, place: { name: 'Bar del Fico', location: { lat: 41.8892, lng: 12.4703 } }, sinceMin: 12 * 60 + 40, motion: 'stationary' as const, stopId: null },
  };

  it('offers whole-trip options and a plain narrative without a model', async () => {
    await replan(trip());
    const r = await tripReplan(trip(), body);
    expect(r.tripOptions.length).toBeGreaterThan(0);
    expect(r.tripOptions.length).toBeLessThanOrEqual(3);
    expect(r.narrative).toBe(fallbackNarrative(body.observation, r.tripOptions));
    expect(r.narrative).toMatch(/^You have stopped somewhere that is not on the plan\./);
    expect(r.quickReplies).toEqual([]);
    expect(h.plans).toHaveLength(1); // nothing stored until applied
  });

  it('uses the planner for the narrative and its quick replies', async () => {
    await replan(trip());
    h.model = () => ({ narrative: 'You have found a bar in Trastevere. I would stay a little and drop the Spanish Steps.', quickReplies: ['Find me lunch near here', 'x'.repeat(200)] });
    const r = await tripReplan(trip(), body);
    expect(r.narrative).toMatch(/Trastevere/);
    expect(r.quickReplies).toEqual(['Find me lunch near here', 'x'.repeat(80)]);
  });

  it('says so when there is no plan', async () => {
    expect(await tripReplan(trip(), body)).toEqual({ tripOptions: [], narrative: 'There is no plan yet to re-plan.', quickReplies: [] });
  });
});
