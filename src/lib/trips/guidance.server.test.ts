import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SolvedPlan } from './model';

// bundleGuidance: a bundle read decorates the plan from the cache and starts
// a background run when a day from today on lacks guidance — never waits for
// it, and not again within ten minutes. The run itself stops at once here
// (no trip in the store), so only its start is seen.
const h = vi.hoisted(() => ({ cache: {} as Record<string, unknown>, getTrip: vi.fn(async () => null) }));
vi.mock('$lib/db', () => ({
  db: { select: () => ({ from: () => ({ where: async () => [{ value: h.cache }] }) }) },
}));
vi.mock('$lib/db/schema', () => ({ appSettings: { key: 'key' } }));
vi.mock('./llm.server', () => ({ jsonCall: async () => { throw new Error('no model'); } }));
vi.mock('./store.server', () => ({ getTrip: h.getTrip, latestPlan: async () => null, loadState: async () => ({ wishes: [] }), setStopGuide: async () => {}, setTripGuide: async () => {} }));

const { bundleGuidance } = await import('./guidance.server');
const { legKey } = await import('./guidance');

const A = { lat: 41.895, lng: 12.4716 };
const B = { lat: 41.8986, lng: 12.4769 };
const plan: SolvedPlan = {
  days: ['2026-10-27', '2026-10-28', '2026-10-29'].map((date) => ({
    date,
    stayId: 's',
    stops: [
      { id: 'a', kind: 'stay', wishId: null, title: 'Flat', location: A, arriveMin: 540, departMin: 540, waitSec: 0, locked: true, bookingId: null, warnings: [] },
      { id: 'b', kind: 'stay', wishId: null, title: 'Flat', location: B, arriveMin: 552, departMin: 600, waitSec: 0, locked: false, bookingId: null, warnings: [] },
    ],
    legs: [{ fromStopId: 'a', toStopId: 'b', mode: 'walk', durationSec: 720, distanceM: 900, estimated: false, line: null }],
    warnings: [],
  })),
  dropped: [],
  warnings: [],
  score: 0,
};
const guide = { gettingAround: 'g', taxi: null, transitTickets: null, tips: [], generatedAt: '2026-10-10T00:00:00Z' };
const trip = (id: string) => ({ id, ownerEmail: 'o@example.test', timeZone: 'Europe/Rome', startDate: '2026-10-27', endDate: '2026-10-29', guide }) as never;
const g = { summary: 'Walk' };

beforeEach(() => {
  h.getTrip.mockClear();
  h.cache = {};
});

describe('bundleGuidance', () => {
  it('starts a background run for days 3+ that lack guidance, once per ten minutes, and returns the cached guidance at once', async () => {
    h.cache = { [legKey('2026-10-27', 'walk', A, B)]: g, [legKey('2026-10-28', 'walk', A, B)]: g };
    const now = new Date('2026-10-15T10:00:00Z');
    const out = await bundleGuidance(trip('t1'), plan, [], now);
    expect(out.days.map((d) => d.legs[0].guidance)).toEqual([g, g, null]);
    await vi.waitFor(() => expect(h.getTrip).toHaveBeenCalledTimes(1));
    await bundleGuidance(trip('t1'), plan, [], new Date(now.getTime() + 60_000));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.getTrip).toHaveBeenCalledTimes(1);
    await bundleGuidance(trip('t1'), plan, [], new Date(now.getTime() + 11 * 60_000));
    await vi.waitFor(() => expect(h.getTrip).toHaveBeenCalledTimes(2));
  });

  it('starts nothing when every day from today on has its guidance', async () => {
    h.cache = Object.fromEntries(plan.days.map((d) => [legKey(d.date, 'walk', A, B), g]));
    await bundleGuidance(trip('t2'), plan, [], new Date('2026-10-15T10:00:00Z'));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.getTrip).not.toHaveBeenCalled();
  });
});
