import { beforeEach, describe, expect, it, vi } from 'vitest';
import { solveTrip } from '$lib/trips/solver';
import { romeInput } from './solver/fixtures/rome';

// findIdeas with the plan, the model (a fake planner driving the agent turn)
// and the map stubbed; the solver is real.
const h = vi.hoisted(() => ({ logged: [] as string[], prompts: [] as string[] }));
const input = romeInput();
const plan = solveTrip(input);

vi.mock('./store.server', () => ({
  latestPlan: async () => ({ id: 'p', version: 3, plan, matrix: input.matrix }),
  listTransport: async () => [],
}));
vi.mock('./plan.server', () => ({ solverInput: async () => ({ input, state: { stays: input.stays, wishes: input.wishes, bookings: input.bookings } }) }));
vi.mock('./converse.server', () => ({ logEdit: async (_t: string, text: string) => void h.logged.push(text) }));
vi.mock('./research.server', () => ({ findPlaceLoosely: async () => null }));
vi.mock('./agent.server', () => ({ agentTurn: async () => ({ reply: '{}', research: [], seenUrls: [], toolCalls: 0 }) }));

const { findIdeas } = await import('./ideas.server');
const trip = { id: 't', ownerEmail: 'o', destination: 'Rome, Italy', timeZone: 'Europe/Rome', profile: null, guide: null } as never;

const places: Record<string, { lat: number; lng: number }> = {
  "Sant'Ignazio, Rome": { lat: 41.8991, lng: 12.4797 },
  'Cooking class, Rome': { lat: 41.8986, lng: 12.4769 },
};
const place = async (q: string) => (places[q] ? { name: q.split(',')[0], location: places[q], osmId: 'way/1', address: q, openingHoursText: null, website: null, wikidata: null } : null);

beforeEach(() => {
  h.logged = [];
  h.prompts = [];
});

describe('findIdeas', () => {
  it('asks about the gap, keeps only ideas the solver fits, and logs the ask', async () => {
    const agent = vi.fn(async (messages: Array<Record<string, unknown>>) => {
      h.prompts.push(String(messages[1].content));
      return {
        reply: JSON.stringify({
          ideas: [
            { title: "Sant'Ignazio", placeQuery: "Sant'Ignazio, Rome", durationMin: 40, why: 'Trompe-l’oeil ceiling, five minutes from the Pantheon', fit: '10 min walk in, 40 there, 15 back' },
            { title: 'Cooking class', placeQuery: 'Cooking class, Rome', durationMin: 600, why: 'Hands-on', fit: 'tight' },
            { title: 'Nowhere', placeQuery: 'Nowhere, Rome', durationMin: 30, why: 'x', fit: 'x' },
          ],
          note: null,
        }),
        research: [{ tool: 'travel_time', summary: 'Timed Lunch → Sant’Ignazio (walk): about 10 min', sources: [] }],
        seenUrls: [],
        toolCalls: 1,
      };
    });
    const r = await findIdeas(trip, { date: '2026-10-28', stage: 'afternoon' }, 'site', { agent: agent as never, place: place as never });
    expect(h.prompts[0]).toContain('Leaving: Lunch at 13:40');
    expect(r.gap?.freeMin).toBe(320);
    expect(r.ideas.map((i) => i.title)).toEqual(["Sant'Ignazio"]);
    expect(r.ideas[0].verdict).toMatchObject({ fits: true, landedStage: 'afternoon' });
    expect(r.ideas[0].wish).toMatchObject({ fixedDate: '2026-10-28', partOfDay: 'afternoon', place: { name: "Sant'Ignazio" } });
    expect(r.rejected.map((x) => x.title)).toEqual(['Cooking class', 'Nowhere']);
    expect(r.research).toHaveLength(1);
    expect(h.logged[0]).toMatch(/^Asked for ideas for Wed 28 Oct afternoon \(13:40–19:00, 320 min between Lunch and Dinner\)\. Found: Sant'Ignazio\./);
  });

  it('says so when nothing fits, and when the planner is unreachable', async () => {
    const none = await findIdeas(trip, { date: '2026-10-28', stage: 'afternoon' }, 'site', {
      agent: (async () => ({ reply: '{"ideas":[]}', research: [], seenUrls: [], toolCalls: 0 })) as never,
      place: place as never,
    });
    expect(none.note).toMatch(/^Nothing the planner found fits 320 minutes between Lunch and Dinner/);
    const down = await findIdeas(trip, { date: '2026-10-28', stage: 'afternoon' }, 'site', { agent: (async () => { throw new Error('no key'); }) as never });
    expect(down.note).toMatch(/not reachable/);
    expect((await findIdeas(trip, { date: '2027-01-01', stage: 'afternoon' })).note).toBe('That day is not in the plan.');
  });
});
