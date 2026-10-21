import { beforeEach, describe, expect, it, vi } from 'vitest';

// v8: a direct edit on the site makes every fact it touches the person's own.
const h = vi.hoisted(() => ({ noted: [] as unknown[], logged: [] as string[] }));

vi.mock('$lib/server/access', () => ({ isOwnerEmail: () => true, getOwnerEmails: () => ['owner@example.test'] }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => false }));
vi.mock('./decisions.store.server', () => ({ noteProvenance: async (_t: string, p: unknown) => void h.noted.push(p) }));
vi.mock('./converse.server', () => ({ logEdit: async (_t: string, text: string) => void h.logged.push(text) }));
vi.mock('./plan.server', () => ({ replan: async () => ({ created: true, plan: { version: 3 } }) }));
vi.mock('./store.server', () => ({ loadState: async () => ({ stays: [], wishes: [], bookings: [] }), getTrip: async () => null }));

const { replanned } = await import('./api.server');
const TRIP = { id: 't1' } as never;

beforeEach(() => {
  h.noted = [];
  h.logged = [];
});

describe('replanned (v8 provenance)', () => {
  it('records a form’s stay and dates as “you”', async () => {
    const res = await replanned(TRIP, { stay: { id: 'st1' } }, 201, [
      { op: 'addStay', name: 'Flat', placeQuery: 'Via X', fromDate: '2026-10-27', toDate: '2026-10-30', checkInMin: null, checkOutMin: null },
      { op: 'setTrip', fields: { startDate: '2026-10-27' } },
    ]);
    expect(res.status).toBe(201);
    expect(h.noted).toEqual([{ 'stay:st1': { source: 'you', note: null, ref: null }, dates: { source: 'you', note: null, ref: null } }]);
    expect(h.logged).toEqual(['Stay added: Flat. Trip details changed (startDate).']);
  });

  it('a removed row takes its entry with it; a re-plan with no edit records nothing', async () => {
    await replanned(TRIP, { deleted: true }, 200, [{ op: 'removeStay', id: 'st1' }]);
    await replanned(TRIP);
    expect(h.noted).toEqual([{ 'stay:st1': null }]);
  });
});
