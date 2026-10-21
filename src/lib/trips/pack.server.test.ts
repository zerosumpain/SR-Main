import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackPlace, PackSummary } from './decisions';
import { EMPTY_PACK } from './decisions';
import type { JobHandle } from './jobs.server';

// The research pack's build with the outside world stubbed: Overpass,
// Nominatim, Wikidata, Commons, Open-Meteo, the web search and the model are
// injected deps; the store is in memory.
const h = vi.hoisted(() => ({
  pack: null as unknown as Record<string, unknown>,
  places: [] as Array<Record<string, unknown>>,
  removed: 0,
  stays: [{ id: 's1', name: 'Flat', address: null, location: { lat: 41.8992, lng: 12.4731 }, fromDate: '2026-10-26', toDate: '2026-10-30', checkInMin: null, checkOutMin: null }] as unknown[],
  wishes: [] as unknown[],
}));

vi.mock('./decisions.store.server', () => ({
  readPack: async () => ({ ...h.pack }),
  writePack: async (_t: string, patch: Record<string, unknown>) => {
    h.pack = { ...h.pack, ...patch };
    return { ...h.pack };
  },
  listPackPlaces: async () => h.places.map((p) => ({ ...p })),
  addPackPlaces: async (_t: string, rows: Array<Record<string, unknown>>) => {
    const saved = rows.map((r, i) => ({ id: `pp-${h.places.length + i}`, ...r }));
    h.places.push(...saved);
    return saved;
  },
  removePackCandidates: async () => {
    const before = h.places.length;
    h.places = h.places.filter((p) => p.status !== 'candidate');
    h.removed += before - h.places.length;
    return before - h.places.length;
  },
  runningJob: async () => null,
}));
vi.mock('./store.server', () => ({
  loadState: async () => ({ stays: h.stays, wishes: h.wishes, bookings: [] }),
  getTripById: async () => null,
}));
vi.mock('./research.server', () => ({ overpass: vi.fn(), nominatimAround: vi.fn(), findPlace: vi.fn() }));
vi.mock('./llm.server', () => ({ jsonCall: vi.fn(async () => { throw new Error('no model in tests'); }) }));

const { buildPack, refreshPack, morePlaces, ensurePack, startPackJob, clearPackBuildsForTest, packWire } = await import('./pack.server');
const { readJob, clearJobsForTest } = await import('./jobs.server');
type Deps = import('./pack.server').PackDeps;

const TRIP = { id: 't1', ownerEmail: 'owner@example.test', title: 'Rome', destination: 'Rome', timeZone: 'Europe/Rome', startDate: '2026-10-26', endDate: '2026-10-30', pace: 'normal', modes: ['walk'], status: 'planned', notes: null, research: null, guide: null, profile: { travellers: [{ name: 'John', relation: null, notes: [] }, { name: 'Sam', relation: null, notes: [], age: 9 }], preferences: [], constraints: [], history: [], gatheredAt: 'x' }, updatedAt: 'x' } as never;

const sight = (i: number, extra: Record<string, string> = {}) => ({ type: 'node', id: 100 + i, lat: 41.89 + i / 1000, lon: 12.47 + i / 1000, tags: { name: `Sight ${i}`, tourism: i % 3 ? 'attraction' : 'museum', wikidata: `Q${1000 + i}`, ...extra } });
const food = (i: number) => ({ type: 'node', id: 500 + i, lat: 41.899 + i / 10000, lon: 12.473, tags: { name: `Trattoria ${i}`, amenity: i < 3 ? 'ice_cream' : 'restaurant', opening_hours: 'Mo-Su 12:00-23:00' } });

function deps(over: Partial<Deps> = {}): Deps & { calls: Record<string, number>; prompts: string[] } {
  const calls: Record<string, number> = { overpass: 0, nominatim: 0, search: 0, model: 0, sparql: 0, commons: 0, forecast: 0 };
  const prompts: string[] = [];
  return {
    calls,
    prompts,
    async overpass(q) {
      calls.overpass++;
      if (q.includes('restaurant|cafe|ice_cream')) return { elements: Array.from({ length: 12 }, (_, i) => food(i)) };
      if (q.includes('place_of_worship')) return { elements: [{ type: 'way', id: 900, center: { lat: 41.9, lon: 12.48 }, tags: { name: 'Villa Quiet', leisure: 'park', wikidata: 'Q900' } }] };
      return { elements: [...Array.from({ length: 45 }, (_, i) => sight(i)), sight(99, { name: 'Borghese Gallery', tourism: 'museum', opening_hours: 'Tu-Su 09:00-19:00; Mo off' })] };
    },
    async nominatim() {
      calls.nominatim++;
      return [];
    },
    async fetchJson(url, init) {
      if (url.includes('query.wikidata.org')) {
        calls.sparql++;
        const ids = [...(init?.form?.query ?? '').matchAll(/wd:(Q\d+)/g)].map((m) => m[1]);
        return { results: { bindings: ids.map((q) => ({ item: { value: `http://www.wikidata.org/entity/${q}` }, links: { value: String(q === 'Q1000' ? 150 : Number(q.slice(1)) % 50) }, ...(q === 'Q1000' ? { image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Big%20one.jpg' } } : {}) })) } };
      }
      if (url.includes('commons.wikimedia.org')) {
        calls.commons++;
        return { query: { pages: { '1': { title: 'File:Big one.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a/800px-Big.jpg', thumbwidth: 800, thumbheight: 600, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Big_one.jpg', extmetadata: {} }] } } } };
      }
      if (url.includes('open-meteo')) {
        calls.forecast++;
        const pop = Array.from({ length: 24 }, (_, h2) => (h2 >= 13 && h2 <= 16 ? 80 : 5));
        return { daily: { time: ['2026-10-29'], sunrise: ['2026-10-29T07:38'], sunset: ['2026-10-29T18:08'] }, hourly: { time: pop.map((_, h2) => `2026-10-29T${String(h2).padStart(2, '0')}:00`), precipitation_probability: pop } };
      }
      return undefined;
    },
    canSearch: async () => false,
    async search() {
      calls.search++;
      return [{ title: 'Official tickets', url: 'https://tickets.example.it/', content: 'Book 14 days ahead.' }];
    },
    async model(_s, user) {
      calls.model++;
      prompts.push(user);
      const refs = [...user.matchAll(/"ref":"(p\d+)","name":"([^"]+)"/g)];
      return {
        places: refs.map(([, ref, name]) => ({ ref, why: `${name}, worth it.`, tags: ['roman'], durationMin: 60, indoor: true, kidFriendly: true, neighbourhood: 'Parione', costText: '€10', bookingRequired: name === 'Sight 0', bookAheadDays: name === 'Sight 0' ? 14 : null, sourceUrls: ['https://tickets.example.it/', 'https://invented.example/'] })),
        neighbourhoods: [{ name: 'Parione', line: 'Baroque squares' }],
        calendar: [{ date: '2026-10-28', kind: 'strike', text: 'Transport strike', sourceUrl: 'https://tickets.example.it/' }],
      };
    },
    cachedImages: async () => ({}),
    rememberImages: async () => {},
    findCentre: async () => ({ lat: 41.89, lng: 12.5 }),
    now: () => new Date('2026-10-21T10:00:00Z'),
    ...over,
  };
}

function handle(cancelAfter: string | null = null): JobHandle & { log: string[] } {
  const log: string[] = [];
  let cancel = false;
  return {
    log,
    keep: () => {},
    stage: (key, state, detail) => {
      log.push(`${key}:${state}${detail ? `:${detail}` : ''}`);
      if (key === cancelAfter && state === 'done') cancel = true;
    },
    cancelled: async () => cancel,
  };
}

beforeEach(() => {
  h.pack = { ...EMPTY_PACK };
  h.places = [];
  h.removed = 0;
  h.wishes = [];
  clearJobsForTest();
  clearPackBuildsForTest();
});
afterEach(() => vi.restoreAllMocks());

describe('research pack build', () => {
  it('without a search key: OSM + Wikidata + the model, booking left unknown, ≤ 3 model calls', async () => {
    const d = deps();
    const hd = handle();
    const { pack, places } = await buildPack(TRIP, hd, d);
    expect(hd.log.filter((l) => /:done/.test(l)).map((l) => l.split(':')[0])).toEqual(['places', 'food', 'hours', 'closures', 'writing']);
    expect(hd.log).toContain('food:done:12 near where you\'ll be');
    expect(hd.log.some((l) => l.startsWith('closures:done:Rain likely on one day · events not checked'))).toBe(true);
    expect(d.calls.search).toBe(0);
    expect(d.calls.model).toBeLessThanOrEqual(3);
    expect(places.length).toBeGreaterThanOrEqual(40);
    expect(places.length).toBeLessThanOrEqual(60);
    // No search → the model's cost and booking are not taken; its why/tags/duration are.
    const s0 = places.find((p) => p.name === 'Sight 0')!;
    expect(s0).toMatchObject({ why: 'Sight 0, worth it.', costText: null, bookingRequired: null, durationMin: 60, indoor: true, lessVisited: false, image: { url: 'https://upload.wikimedia.org/a/800px-Big.jpg' } });
    expect(s0.sources.map((s) => s.url)).not.toContain('https://invented.example/');
    expect(s0.facts?.unknown).toContain('whether booking is needed');
    expect(places.filter((p) => p.lessVisited).length).toBeGreaterThan(5);
    expect(pack).toMatchObject({ status: 'ready', stage: null, builtAt: '2026-10-21T10:00:00.000Z' });
    expect(pack.counts.food).toBe(12);
    expect(pack.calendar.map((c) => c.text)).toEqual(['Borghese Gallery is closed on Mon 26 Oct', 'Rain likely in the afternoon', 'Light from about 07:38 to 18:08']);
    expect(pack.highlights[0]).toMatch(/^Found \d+ places$/);
    expect(pack.highlights).toContain('Rain likely Thu afternoon');
    // The travellers (names, children's ages) shape the write-up; nothing else from the profile.
    expect(d.prompts[0]).toContain('Travelling: John, Sam (9).');
  });

  it('with a search key: one search per batch plus the calendar, ≤ 6, and only facts a result supports', async () => {
    const d = deps({ canSearch: async () => true });
    const { pack, places } = await buildPack(TRIP, handle(), d);
    expect(d.calls.search).toBeGreaterThan(1);
    expect(d.calls.search).toBeLessThanOrEqual(6);
    const s0 = places.find((p) => p.name === 'Sight 0')!;
    expect(s0).toMatchObject({ costText: '€10', bookingRequired: true, bookAheadDays: 14 });
    expect(s0.sources[0]).toEqual({ url: 'https://tickets.example.it/', title: 'Official tickets' });
    expect(pack.calendar.some((c) => c.kind === 'strike' && c.text === 'Transport strike')).toBe(true);
    expect(pack.highlights.some((x) => /need(s)? booking — Sight 0 about 14 days ahead/.test(x))).toBe(true);
  });

  it('Overpass busy → Nominatim, paced, one term at a time', async () => {
    const d = deps({ overpass: async () => null });
    await buildPack(TRIP, handle(), d);
    expect(d.calls.nominatim).toBe(8 + 3);
  });

  it('no stay yet: looks round the destination centre', async () => {
    const was = h.stays;
    h.stays = [];
    const d = deps();
    const findCentre = vi.fn(async () => ({ lat: 41.9, lng: 12.5 }));
    const hd = handle();
    await buildPack(TRIP, hd, { ...d, findCentre });
    expect(findCentre).toHaveBeenCalledWith('Rome');
    expect(hd.log).toContain('food:done:12 near the centre');
    h.stays = was;
  });

  it('a rebuild keeps planned and turned-down places, does not repeat them, and marks wishes planned', async () => {
    h.places = [
      { id: 'old-1', name: 'Sight 1', kind: 'sight', status: 'planned', place: { osmId: 'node/101' }, tags: [], lessVisited: false, bookingRequired: null, indoor: null },
      { id: 'old-2', name: 'Old candidate', kind: 'sight', status: 'candidate', place: { osmId: 'node/1' }, tags: [], lessVisited: false, bookingRequired: null, indoor: null },
    ];
    h.wishes = [{ id: 'w-5', title: 'Sight 5', place: { osmId: 'node/105' }, skipped: false, suggested: false }];
    const { places } = await buildPack(TRIP, handle(), deps());
    expect(h.removed).toBe(1);
    expect(places.filter((p) => p.name === 'Sight 1')).toHaveLength(1);
    expect(places.find((p) => p.name === 'Sight 5')).toMatchObject({ status: 'planned', wishId: 'w-5' });
  });

  it('cancelled part way: stops, keeps the pack it had', async () => {
    h.pack = { ...EMPTY_PACK, status: 'ready', builtAt: '2026-10-01T00:00:00Z', highlights: ['Found 3 places'] };
    h.places = [{ id: 'keep', name: 'Kept', kind: 'sight', status: 'candidate', place: { osmId: 'node/7' } }];
    await expect(buildPack(TRIP, handle('food'), deps())).rejects.toThrow('cancelled');
    expect(h.places.map((p) => p.id)).toEqual(['keep']);
    expect(h.pack).toMatchObject({ status: 'ready', stage: null, highlights: ['Found 3 places'] });
  });

  it('a first build that fails says so', async () => {
    const d = deps({ findCentre: async () => null });
    h.stays = [];
    await expect(buildPack(TRIP, handle(), d)).rejects.toThrow();
    expect(h.pack.status).toBe('failed');
    h.stays = [{ id: 's1', name: 'Flat', address: null, location: { lat: 41.8992, lng: 12.4731 }, fromDate: '2026-10-26', toDate: '2026-10-30', checkInMin: null, checkOutMin: null }];
  });
});

describe('refresh and more', () => {
  it('refresh: hours, closures, events and weather again; places untouched', async () => {
    const pp = (name: string, hours: string): Partial<PackPlace> => ({ id: name, name, kind: 'museum', status: 'candidate', tags: [], lessVisited: false, bookingRequired: null, indoor: true, facts: { openingHoursText: hours, hours: null, closedDates: [] } as never });
    h.places = [pp('Borghese Gallery', 'Tu-Su 09:00-19:00; Mo off'), pp('Pantheon', 'Mo-Su 09:00-19:00')] as never;
    h.pack = { ...EMPTY_PACK, status: 'ready', builtAt: '2026-10-01T00:00:00Z', calendar: [{ date: null, kind: 'event', text: 'Found online before', placeId: null, sources: [{ url: 'https://x.example/', title: null }] }] };
    const d = deps({ canSearch: async () => true });
    const hd = handle();
    const { pack } = await refreshPack(TRIP, hd, d);
    expect(hd.log.filter((l) => /:done/.test(l)).map((l) => l.split(':')[0])).toEqual(['hours', 'closures', 'writing']);
    expect(d.calls.search).toBe(1);
    expect(d.calls.model).toBe(1);
    expect(pack).toMatchObject({ status: 'ready', refreshedAt: '2026-10-21T10:00:00.000Z', builtAt: '2026-10-01T00:00:00Z' });
    expect(pack.calendar.map((c) => c.text)).toEqual(['Transport strike', 'Borghese Gallery is closed on Mon 26 Oct', 'Rain likely in the afternoon', 'Light from about 07:38 to 18:08']);
    expect(h.places).toHaveLength(2);
  });

  it('more: a themed look further adds new places only', async () => {
    h.places = [{ id: 'a', name: 'Sight 0', kind: 'sight', status: 'candidate', place: { osmId: 'node/100' }, tags: [], lessVisited: false, bookingRequired: null, indoor: null }];
    h.pack = { ...EMPTY_PACK, status: 'ready' };
    const d = deps();
    const { places, pack } = await morePlaces(TRIP, 'rainy day', handle(), d);
    expect(places.filter((p) => p.name === 'Sight 0')).toHaveLength(1);
    expect(places.length).toBeGreaterThan(1);
    expect(places.length).toBeLessThanOrEqual(13);
    expect(places.at(-1)!.tags).toContain('rainy day');
    expect(d.calls.model).toBe(1);
    expect(pack.status).toBe('ready');
  });
});

describe('the pack job and ensurePack', () => {
  it('a job with the five stages; a second start joins it; the result is { pack, places }', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps();
    const first = startPackJob(TRIP, 'owner@example.test', 'build', { deps: d, questions: false });
    expect(first.job.stages.map((s) => s.label)).toEqual(['Finding places', 'Finding places to eat', 'Checking opening hours on your dates', 'Looking for closures and events', 'Writing it up']);
    expect(first.job.tripId).toBe('t1');
    const second = startPackJob(TRIP, 'kid@example.test', 'build', { deps: d });
    expect(second).toMatchObject({ joined: true, mine: false });
    await vi.waitFor(() => expect(readJob('owner@example.test', first.job.id)?.status).toBe('done'));
    const done = readJob('owner@example.test', first.job.id)!;
    expect((done.result as { pack: PackSummary }).pack.status).toBe('ready');
    expect(done.stages.every((s) => s.state === 'done')).toBe(true);
  });

  it('ensurePack on a read: builds inside the week before, otherwise nothing', async () => {
    const started: string[] = [];
    const d = deps({ overpass: async () => { started.push('overpass'); return null; } });
    await ensurePack({ ...TRIP, startDate: '2027-03-01', endDate: '2027-03-04' } as never, { reason: 'read', deps: d });
    expect(started).toEqual([]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    await ensurePack(TRIP, { reason: 'read', deps: d });
    vi.useRealTimers();
    await vi.waitFor(() => expect(started.length).toBeGreaterThan(0));
  });

  it('GET pack filters', async () => {
    h.places = [{ id: 'a', kind: 'gelato', tags: [] }, { id: 'b', kind: 'museum', tags: ['rainy-day'] }];
    expect((await packWire('t1', { kind: 'food' })).places.map((p) => p.id)).toEqual(['a']);
    expect((await packWire('t1', { tag: 'rainy-day' })).places.map((p) => p.id)).toEqual(['b']);
  });
});
