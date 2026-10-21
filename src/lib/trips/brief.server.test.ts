import { beforeEach, describe, expect, it, vi } from 'vitest';

// Direct edits to the brief with the stores stubbed: each becomes ops applied
// as the person's own, one re-solve, a logged event; confirm only rewrites
// where a fact came from.
const h = vi.hoisted(() => ({
  applied: [] as Array<{ ops: unknown[]; opts: unknown }>,
  rejectAll: false,
  provenance: {} as Record<string, unknown>,
  noted: [] as unknown[],
  replans: 0,
  logged: [] as string[],
  ensured: [] as unknown[],
}));

const TRIP = {
  id: 't1', ownerEmail: 'o@example.test', title: 'Rome', destination: 'Rome, Italy', timeZone: 'Europe/Rome', startDate: '2026-10-27', endDate: '2026-10-30',
  pace: 'normal', modes: ['walk'], status: 'planned', notes: null, dayLoads: {}, research: null, guide: null, updatedAt: 'x',
  profile: { travellers: [{ name: 'John', relation: null, notes: [] }], preferences: [{ text: 'Likes a long lunch', source: 'memory', ref: 'memory:1' }], constraints: [], history: [], gatheredAt: 'x' },
} as never;

vi.mock('./store.server', () => ({
  loadState: async () => ({ stays: [], wishes: [], bookings: [] }),
  listTransport: async () => [],
  latestPlan: async () => ({ version: 7 }),
  getTripById: async () => TRIP,
  tripOnly: (t: Record<string, unknown>) => {
    const { research: _r, updatedAt: _u, guide: _g, profile: _p, ...rest } = t;
    return rest;
  },
}));
vi.mock('./decisions.store.server', () => ({
  readProvenance: async () => h.provenance,
  noteProvenance: async (_t: string, p: unknown) => void h.noted.push(p),
}));
vi.mock('./decisions.bundle.server', async () => ({
  phoneBrief: (b: { items: Array<{ kind: string }> }) => ({ ...b, items: b.items.filter((i) => i.kind !== 'preference' && i.kind !== 'constraint') }),
}));
vi.mock('./converse.server', () => ({
  applyDirect: async (_t: unknown, ops: Array<{ op: string }>, opts: unknown) => {
    h.applied.push({ ops, opts });
    if (h.rejectAll) return { result: { applied: [], rejected: ops.map((op) => ({ op, reason: 'The last day is before the first.' })), research: [], suggest: [], changed: false }, created: { stays: [], wishes: [], bookings: [], transport: [] } };
    return { result: { applied: ops, rejected: [], research: [], suggest: [], changed: ops.some((o) => o.op !== 'updateProfile') }, created: { stays: [], wishes: [], bookings: [], transport: [] } };
  },
  logEdit: async (_t: string, text: string) => void h.logged.push(text),
}));
vi.mock('./plan.server', () => ({
  replan: async () => {
    h.replans++;
    return { created: true, plan: { version: 8, changes: ['Trevi now 15:00 instead of 11:00 on Wed 28 Oct.'] } };
  },
}));
vi.mock('./pack.server', () => ({ ensurePack: async (_t: unknown, o: unknown) => void h.ensured.push(o) }));

const { patchBrief } = await import('./brief.server');

beforeEach(() => {
  h.applied = [];
  h.rejectAll = false;
  h.provenance = {};
  h.noted = [];
  h.replans = 0;
  h.logged = [];
  h.ensured = [];
});

describe('patchBrief', () => {
  it('a pace change is applied as the person’s own, re-solved once and logged', async () => {
    const r = await patchBrief(TRIP, { field: 'pace', pace: 'relaxed' }, { name: 'John', surface: 'site' });
    expect(h.applied).toEqual([{ ops: [{ op: 'setTrip', fields: { pace: 'relaxed' } }], opts: { provenance: 'you' } }]);
    expect(h.replans).toBe(1);
    expect(h.logged).toEqual(['John: Trip details changed (pace).']);
    expect(r).toMatchObject({ status: 200, body: { planVersion: 8, changes: ['Trevi now 15:00 instead of 11:00 on Wed 28 Oct.'], brief: { items: expect.any(Array) } } });
    // The site's brief keeps the owner's notes; nothing changed the destination, so the pack stays.
    expect((r.body.brief as { items: Array<{ kind: string }> }).items.some((i) => i.kind === 'preference')).toBe(true);
    expect(h.ensured).toEqual([]);
  });

  it('new dates rebuild the research pack; the phone gets the phone brief', async () => {
    const r = await patchBrief(TRIP, { field: 'dates', startDate: '2026-10-28', endDate: '2026-10-31' }, { name: 'Sam', surface: 'phone' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.ensured).toEqual([{ reason: 'changed' }]);
    expect((r.body.brief as { items: Array<{ kind: string }> }).items.some((i) => i.kind === 'preference')).toBe(false);
  });

  it('confirming an assumption only rewrites where it came from', async () => {
    h.provenance = { 'meal-times': { source: 'assumed', note: 'Dinner around 19:30', ref: null, at: 'x' } };
    const r = await patchBrief(TRIP, { field: 'confirm', key: 'meal-times' }, { name: null, surface: 'site' });
    expect(h.noted).toEqual([{ 'meal-times': { source: 'you', note: null, ref: null } }]);
    expect(h.applied).toEqual([]);
    expect(r).toMatchObject({ status: 200, body: { planVersion: 7, changes: [] } });
  });

  it('says why an edit could not be made', async () => {
    expect(await patchBrief(TRIP, { field: 'remove', key: 'stay:nope' }, { name: null, surface: 'site' })).toEqual({ status: 400, body: { error: 'No such stay.' } });
    h.rejectAll = true;
    expect(await patchBrief(TRIP, { field: 'dates', startDate: '2026-10-30', endDate: '2026-10-27' }, { name: null, surface: 'site' })).toEqual({ status: 400, body: { error: 'The last day is before the first.' } });
    expect(h.replans).toBe(0);
  });
});
