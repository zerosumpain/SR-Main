import { beforeEach, describe, expect, it, vi } from 'vitest';
import { solveTrip } from '$lib/trips/solver';
import { romeInput, romePoints } from './solver/fixtures/rome';
import { estimateMatrix } from './solver/estimate';

// findIdeas with the plan, the model (a fake planner driving the agent turn)
// and the map stubbed; the solver is real.
const h = vi.hoisted(() => ({ logged: [] as string[], prompts: [] as string[], fx: null as unknown as { input: ReturnType<typeof romeInput>; plan: ReturnType<typeof solveTrip> } }));
const rome = (() => {
  const input = romeInput();
  return { input, plan: solveTrip(input) };
})();

vi.mock('./store.server', () => ({
  latestPlan: async () => ({ id: 'p', version: 3, plan: h.fx.plan, matrix: h.fx.input.matrix }),
  listTransport: async () => [],
}));
vi.mock('./plan.server', () => ({
  solverInput: async () => ({ input: h.fx.input, state: { stays: h.fx.input.stays, wishes: h.fx.input.wishes, bookings: h.fx.input.bookings } }),
}));
vi.mock('./converse.server', () => ({ logEdit: async (_t: string, text: string) => void h.logged.push(text) }));
vi.mock('./research.server', () => ({ findPlaceLoosely: async () => null, overpass: async () => null, nominatimAround: async () => [] }));
vi.mock('./llm.server', () => ({ jsonCall: async () => { throw new Error('no key'); } }));
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
  h.fx = rome;
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
    expect(none.note).toMatch(/^Nothing fits 320 minutes between Lunch and Dinner/);
    const down = await findIdeas(trip, { date: '2026-10-28', stage: 'afternoon' }, 'site', { agent: (async () => { throw new Error('no key'); }) as never });
    expect(down.note).toMatch(/not reachable just now and nothing nearby fits/);
    expect(h.logged.at(-1)).toMatch(/Planner error: unreachable\. Nothing fitted\. Nearby search: OpenStreetMap did not answer\./);
    expect((await findIdeas(trip, { date: '2027-01-01', stage: 'afternoon' })).note).toBe('That day is not in the plan.');
  });
});

// ── v6: ideas that always come back ─────────────────────────────────────────

/**
 * The logged production ask, reproduced: Rome, Tue 27 Oct, a light day —
 * Pantheon until 12:46, lunch, then "Free time at Accommodation near Piazza
 * Navona" from 14:03: a 77-minute lunch gap the planner answered with nothing.
 */
function romeLunch() {
  const input = romeInput();
  const stay = { ...input.stays[0], name: 'Accommodation near Piazza Navona', location: { lat: 41.8985, lng: 12.4718 } };
  const on: Record<string, string> = { pantheon: '2026-10-27', colosseum: '2026-10-28', vatican: '2026-10-29', borghese: '2026-10-30' };
  const wishes = input.wishes.filter((w) => on[w.id]).map((w) => ({ ...w, fixedDate: on[w.id], fixedStartMin: w.id === 'pantheon' ? 721 : null }));
  const fixture = { ...input, stays: [stay], wishes, matrix: estimateMatrix(romePoints(wishes, [stay]), input.trip.modes) };
  return { input: fixture, plan: solveTrip(fixture) };
}
const LUNCH_ASK = { date: '2026-10-27', stage: 'lunch' as const, afterStopId: 'pantheon', beforeStopId: 'stay:2026-10-27:rest' };

/** An Overpass answer around the Pantheon: two trattorias close by, one across the river, one already a wish. */
const OSM_LUNCH = {
  elements: [
    { type: 'node', id: 1, lat: 41.8989, lon: 12.4757, tags: { amenity: 'restaurant', name: 'Armando al Pantheon', 'diet:vegetarian': 'yes' } },
    { type: 'node', id: 2, lat: 41.8979, lon: 12.4745, tags: { amenity: 'restaurant', name: 'Osteria del Sostegno' } },
    { type: 'node', id: 3, lat: 41.8862, lon: 12.4668, tags: { amenity: 'restaurant', name: 'Far Trastevere' } },
    { type: 'node', id: 4, lat: 41.8986, lon: 12.4769, tags: { amenity: 'cafe', name: 'Pantheon' } },
  ],
};

describe('v6: the Rome lunch gap that came back empty', () => {
  it('reproduces the 77-minute gap, and the nearby fallback brings back verified lunches', async () => {
    h.fx = romeLunch();
    const queries: string[] = [];
    const agent = vi.fn(async () => ({ reply: '{"ideas":[],"note":null}', research: [], seenUrls: [], toolCalls: 0 }));
    const r = await findIdeas(trip, LUNCH_ASK, 'phone', {
      agent: agent as never,
      overpass: async (q) => {
        queries.push(q);
        return OSM_LUNCH;
      },
    });
    expect(r.gap).toMatchObject({ freeMin: 77, meal: 'lunch', before: { title: 'Pantheon', min: 766 }, after: { title: 'Free time at Accommodation near Piazza Navona', min: 843 } });
    // The smaller budget is asked for.
    expect((agent.mock.calls[0] as unknown[])[2]).toMatchObject({ budget: { calls: 4, searches: 2 } });
    expect(queries[0]).toContain('restaurant|cafe');
    expect(r.ideas.length).toBeGreaterThanOrEqual(1);
    expect(r.ideas.every((i) => i.source === 'nearby' && i.verdict.fits)).toBe(true);
    expect(r.ideas[0].title).toBe('Armando al Pantheon');
    expect(r.ideas[0].wish).toMatchObject({ fixedDate: '2026-10-27', replacesMeal: 'lunch', place: { osmId: 'node/1' } });
    expect(r.ideas.map((i) => i.title)).not.toContain('Pantheon');
    expect(r.note).toMatch(/^These are places near the way from Pantheon/);
    expect(h.logged[0]).toMatch(/^Asked for ideas for Tue 27 Oct lunch \(12:46–14:03, 77 min between Pantheon and Free time at Accommodation near Piazza Navona\)\. Found: Armando al Pantheon \(nearby\)/);
  });

  it('falls back when the planner fails, and logs the error kind', async () => {
    h.fx = romeLunch();
    const r = await findIdeas(trip, LUNCH_ASK, 'phone', {
      agent: (async () => {
        throw new Error('Request timed out.');
      }) as never,
      overpass: async () => OSM_LUNCH,
    });
    expect(r.ideas[0]).toMatchObject({ source: 'nearby', title: 'Armando al Pantheon' });
    expect(r.note).toMatch(/^The planner took too long, so these are places near the way/);
    expect(h.logged[0]).toMatch(/Planner error: timeout\. Found: Armando al Pantheon \(nearby\)/);
  });

  it('gives up on a planner that hangs past its deadline', async () => {
    h.fx = romeLunch();
    const r = await findIdeas(trip, LUNCH_ASK, 'phone', { agent: (() => new Promise(() => {})) as never, overpass: async () => OSM_LUNCH, plannerMs: 20 });
    expect(r.ideas[0].source).toBe('nearby');
    expect(h.logged[0]).toMatch(/Planner error: timeout\./);
  });

  it('repairs an unreadable answer once, and uses the planner’s ideas', async () => {
    h.fx = romeLunch();
    const repair = vi.fn(async () => ({ ideas: [{ title: 'Armando al Pantheon', placeQuery: 'Armando al Pantheon, Rome', durationMin: 60, why: 'Roman classics', fit: '2 min walk' }], note: null }));
    const r = await findIdeas(trip, LUNCH_ASK, 'phone', {
      agent: (async () => ({ reply: 'Try Armando al Pantheon for lunch, about an hour.', research: [], seenUrls: [], toolCalls: 0 })) as never,
      repair,
      place: (async () => ({ name: 'Armando al Pantheon', location: { lat: 41.8989, lng: 12.4757 }, osmId: 'node/1', address: null })) as never,
      overpass: async () => {
        throw new Error('should not be needed');
      },
    });
    expect(repair).toHaveBeenCalledTimes(1);
    expect(r.ideas).toHaveLength(1);
    expect(r.ideas[0]).toMatchObject({ source: 'planner', verdict: { fits: true, landedStage: 'lunch' } });
  });

  it('an answer that cannot be repaired is an "unreadable" failure, and still falls back', async () => {
    h.fx = romeLunch();
    const r = await findIdeas(trip, LUNCH_ASK, 'phone', {
      agent: (async () => ({ reply: 'garbled', research: [], seenUrls: [], toolCalls: 0 })) as never,
      repair: async () => 'still garbled',
      overpass: async () => OSM_LUNCH,
    });
    expect(r.ideas[0].source).toBe('nearby');
    expect(h.logged[0]).toMatch(/Planner error: unreadable\./);
  });

  it('when Overpass is busy, Nominatim’s bounded search stands in', async () => {
    h.fx = romeLunch();
    const terms: string[] = [];
    const r = await findIdeas(trip, LUNCH_ASK, 'phone', {
      agent: (async () => ({ reply: '{"ideas":[]}', research: [], seenUrls: [], toolCalls: 0 })) as never,
      overpass: async () => null,
      nominatim: async (term) => {
        terms.push(term);
        return term === 'restaurant' ? [{ osm_type: 'node', osm_id: 1, lat: '41.8989', lon: '12.4757', category: 'amenity', type: 'restaurant', name: 'Armando al Pantheon', extratags: {} }] : [];
      },
    });
    expect(terms).toEqual(['restaurant', 'cafe']);
    expect(r.ideas[0]).toMatchObject({ source: 'nearby', title: 'Armando al Pantheon', wish: { place: { osmId: 'node/1' } } });
  });

  it('says plainly, and logs, when neither the planner nor the map has anything', async () => {
    h.fx = romeLunch();
    const r = await findIdeas(trip, LUNCH_ASK, 'phone', { agent: (async () => ({ reply: '{"ideas":[]}', research: [], seenUrls: [], toolCalls: 0 })) as never, overpass: async () => ({ elements: [] }) });
    expect(r.ideas).toEqual([]);
    expect(r.note).toMatch(/^Nothing fits 77 minutes between Pantheon and Free time/);
    expect(h.logged[0]).toMatch(/Nothing fitted\. Nearby search: no places found nearby\.$/);
  });

  it('a namesake found far from the trip is "not found", never a far-away match', async () => {
    const agent = async () => ({
      reply: JSON.stringify({ ideas: [{ title: "Sant'Ignazio", placeQuery: "Sant'Ignazio, Rome", durationMin: 40, why: 'x', fit: 'x' }], note: null }),
      research: [],
      seenUrls: [],
      toolCalls: 0,
    });
    // The worldwide fallback's first hit: a church of that name in Buenos Aires.
    const far = async () => ({ name: "Sant'Ignazio", location: { lat: -34.6083, lng: -58.3712 }, osmId: 'way/9', address: 'Buenos Aires', openingHoursText: null, website: null, wikidata: null });
    const r = await findIdeas(trip, { date: '2026-10-28', stage: 'afternoon' }, 'site', { agent: agent as never, place: far as never });
    expect(r.ideas.filter((i) => i.source === 'planner')).toEqual([]);
    expect(r.rejected[0]).toEqual({ title: "Sant'Ignazio", reason: "“Sant'Ignazio, Rome” was not found on the map near there." });
  });

  it("an idea is checked against its own OSM hours: closed then is turned down with why", async () => {
    const agent = async () => ({
      reply: JSON.stringify({ ideas: [{ title: "Sant'Ignazio", placeQuery: "Sant'Ignazio, Rome", durationMin: 40, why: 'x', fit: 'x' }], note: null }),
      research: [],
      seenUrls: [],
      toolCalls: 0,
    });
    const withHours = (openingHoursText: string) => async (q: string) => ({ ...(await place(q))!, openingHoursText });
    const morning = await findIdeas(trip, { date: '2026-10-28', stage: 'afternoon' }, 'site', { agent: agent as never, place: withHours('Mo-Su 07:30-12:30') as never });
    expect(morning.ideas.filter((i) => i.source === 'planner')).toEqual([]);
    // Without its hours this idea used to fit; now the solver (or the hours guard) says why not.
    expect(morning.rejected[0]?.title).toBe("Sant'Ignazio");
    expect(morning.rejected[0]?.reason).toMatch(/closed/i);
    const wednesday = await findIdeas(trip, { date: '2026-10-28', stage: 'afternoon' }, 'site', { agent: agent as never, place: withHours('Mo-Tu,Th-Su 09:00-19:00; We off') as never });
    expect(wednesday.ideas.filter((i) => i.source === 'planner')).toEqual([]);
    expect(wednesday.rejected[0]?.reason).toMatch(/closed/i);
    const open = await findIdeas(trip, { date: '2026-10-28', stage: 'afternoon' }, 'site', { agent: agent as never, place: withHours('Mo-Su 09:00-19:00') as never });
    expect(open.ideas.map((i) => i.title)).toEqual(["Sant'Ignazio"]);
  });
});

