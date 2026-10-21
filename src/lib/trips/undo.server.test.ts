import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Wish } from './model';

// Undo with the stores stubbed: which snapshot is read, what is written back,
// that the re-solve appends a version led by "Undone: …", and that the
// research pack follows its wishes.
const h = vi.hoisted(() => ({
  latest: null as null | { version: number; plan: unknown },
  snapshots: new Map<number, unknown>(),
  wishes: [] as Wish[],
  restored: [] as unknown[],
  replans: [] as Array<{ source: string; opts: { lead?: string[] } }>,
  logged: [] as string[],
  pack: [] as Array<Record<string, unknown>>,
  packUpdates: [] as unknown[],
  created: true,
}));

const wish = (id: string, title: string, extra: Partial<Wish> = {}): Wish => ({
  id, title, place: { name: title, location: { lat: 41.9, lng: 12.47 }, osmId: `way/${id}`, address: null }, priority: 'nice', durationSec: 3600, partOfDay: 'any', fixedDate: null, fixedStartMin: null, locked: false, suggested: false, skipped: false, facts: null, note: null, sortHint: 10, replacesMeal: null, ...extra,
});
const TRIP = { id: 't1', ownerEmail: 'o@example.test', title: 'Rome', destination: 'Rome, Italy', timeZone: 'Europe/Rome', startDate: '2026-10-27', endDate: '2026-10-28', pace: 'normal', modes: ['walk'], status: 'planned', notes: null, dayLoads: {}, research: null, guide: null, profile: null, updatedAt: 'x' } as never;
const PLAN = { days: [], dropped: [], warnings: [], score: 0 };

vi.mock('./store.server', () => ({
  latestPlan: async () => h.latest,
  listTransport: async () => [],
  loadState: async () => ({ stays: [], wishes: h.wishes, bookings: [] }),
  getTripById: async () => TRIP,
  tripOnly: (t: Record<string, unknown>) => {
    const { research: _r, updatedAt: _u, guide: _g, profile: _p, ...rest } = t;
    return rest;
  },
}));
vi.mock('./decisions.store.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./decisions.store.server')>()),
  planConstraints: async (_t: string, v: number) => h.snapshots.get(v) ?? null,
  listPackPlaces: async () => h.pack,
  updatePackPlace: async (_t: string, id: string, patch: unknown) => void h.packUpdates.push({ id, patch }),
}));
vi.mock('./undo.store.server', () => ({ restoreConstraints: async (_t: string, a: unknown) => void h.restored.push(a) }));
vi.mock('./converse.server', () => ({ logEdit: async (_t: string, text: string) => void h.logged.push(text) }));
vi.mock('./questions.server', () => ({ refreshQuestions: async () => [] }));
vi.mock('./plan.server', () => ({
  replan: async (_t: unknown, source: string, opts: { lead?: string[] }) => {
    h.replans.push({ source, opts });
    return { created: h.created, plan: { version: 6, changes: [...(opts.lead ?? []), 'Capitoline Museums added on Wed 28 Oct at 14:00.'], plan: PLAN } };
  },
}));

const { undoTo } = await import('./undo.server');
const { constraintsOf } = await import('./decisions.store.server');

const CALLER = { name: 'John', surface: 'phone' as const };

beforeEach(() => {
  h.latest = { version: 5, plan: PLAN };
  h.wishes = [wish('w1', 'Pantheon'), wish('w3', 'Palazzo Altemps')];
  // Version 4: before the swap — the Capitoline, not Altemps.
  h.snapshots = new Map([[4, constraintsOf((({ research: _r, updatedAt: _u, guide: _g, profile: _p, ...t }) => t)(TRIP as never) as never, { stays: [], wishes: [wish('w1', 'Pantheon'), wish('w2', 'Capitoline Museums')], bookings: [] }, [])]]);
  h.restored = [];
  h.replans = [];
  h.logged = [];
  h.pack = [{ id: 'pk-altemps', status: 'planned', wishId: 'w3', name: 'Palazzo Altemps', place: { osmId: 'way/w3' } }, { id: 'pk-capitoline', status: 'candidate', wishId: null, name: 'Capitoline Museums', place: { osmId: 'way/w2' } }];
  h.packUpdates = [];
  h.created = true;
});

describe('undoTo', () => {
  it('puts the version before back and re-solves into a NEW version led by “Undone: …”', async () => {
    const r = await undoTo(TRIP, null, CALLER);
    expect(r.status).toBe(200);
    expect(h.restored).toEqual([expect.objectContaining({ wishes: { insert: [expect.objectContaining({ id: 'w2', title: 'Capitoline Museums' })], update: [], remove: ['w3'] }, trip: null })]);
    const lead = 'Undone: back to version 4 — Palazzo Altemps taken off; Capitoline Museums back.';
    expect(h.replans).toEqual([{ source: 'phone', opts: { keepRunningDay: false, lead: [lead] } }]);
    expect(r.body).toMatchObject({ planVersion: 6, changes: [lead, 'Capitoline Museums added on Wed 28 Oct at 14:00.'], diff: expect.objectContaining({ lines: expect.any(Array) }) });
    expect(h.logged).toEqual([`John: ${lead}`]);
    // The pack follows: Altemps back on the long list, the Capitoline planned again.
    expect(h.packUpdates).toEqual([
      { id: 'pk-altemps', patch: { status: 'candidate', wishId: null } },
      { id: 'pk-capitoline', patch: { status: 'planned', wishId: 'w2' } },
    ]);
  });

  it('refuses a version made before snapshots, and versions that are not there', async () => {
    expect(await undoTo(TRIP, 3, CALLER)).toEqual({ status: 409, body: { error: 'Version 3 was made before undo was possible, so it cannot be restored.' } });
    expect(await undoTo(TRIP, 5, CALLER)).toMatchObject({ status: 409, body: { error: 'That is the plan as it stands.' } });
    expect(await undoTo(TRIP, 9, CALLER)).toMatchObject({ status: 400 });
    expect(h.restored).toEqual([]);
    h.latest = null;
    expect(await undoTo(TRIP, null, CALLER)).toMatchObject({ status: 409, body: { error: 'There is nothing to undo yet.' } });
  });

  it('says so when the plan already matches', async () => {
    h.created = false;
    expect(await undoTo(TRIP, 4, CALLER)).toEqual({ status: 409, body: { error: 'The plan already matches version 4.' } });
  });
});
