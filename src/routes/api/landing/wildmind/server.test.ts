import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import recorded from '$lib/landing/fixtures/wildmind-day16.json';

const h = vi.hoisted(() => ({ env: {} as Record<string, string | undefined>, dev: false }));
vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('$app/environment', () => ({
  get dev() {
    return h.dev;
  },
}));

import { GET } from './+server';
import {
  DRAW_HOLD_MS,
  FIXTURE_COOKIE,
  MAX_BYTES,
  RETRY_MS,
  STALE_MS,
  TTL_MS,
  loadWildmind,
  pinFixtureState,
  pinnedFixtureState,
  readWildmind,
  resetWildmind,
  wildmindShowcase,
} from '$lib/landing/wildmind.server';
import type { WildmindShowcase } from '$lib/landing/wildmind';

const URL_ = 'http://wildmind.test:5397/api/public/snapshot';
/** A cookie jar as SvelteKit's `cookies` reads and writes it. */
const jar = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { get: (k: string) => m.get(k), set: (k: string, v: string) => void m.set(k, v), delete: (k: string) => void m.delete(k), m };
};
const call = async (q = '', cookies = jar()) => {
  const res = await GET({ url: new URL(`http://site.test/api/landing/wildmind${q}`), cookies } as never);
  return { res, body: (await res.json()) as WildmindShowcase };
};
const withoutTerrain = () => {
  const { terrain: _, ...rest } = structuredClone(recorded) as Record<string, unknown>;
  return rest;
};

let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const k of Object.keys(h.env)) delete h.env[k];
  h.dev = false;
  resetWildmind();
  upstream = vi.fn(async (input: URL | string) => {
    const u = new URL(String(input));
    const body = u.searchParams.get('have') === recorded.terrainVersion ? withoutTerrain() : recorded;
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/landing/wildmind', () => {
  it('answers 200 offline, without asking anyone, when Wildmind is not configured', async () => {
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=1, stale-while-revalidate=5');
    expect(body.state).toBe('offline');
    expect(body.map).toBeNull();
    expect(upstream).not.toHaveBeenCalled();
    expect(await wildmindShowcase()).toBeNull();
  });

  it('answers with the valley and its map', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(body.state).toBe('live');
    expect(body.map?.layers.length).toBeGreaterThan(0);
    expect(body.mapVersion).toBe(recorded.terrainVersion);
    expect(body.people.map((p) => p.name)).toEqual(['JKai', 'Wren']);
  });

  it('leaves the map out when the page already has this version', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const { body } = await call(`?have=${encodeURIComponent(recorded.terrainVersion)}`);
    expect(body.map).toBeNull();
    expect(body.mapVersion).toBe(recorded.terrainVersion);
    expect(body.people).toHaveLength(2);
    const other = await call('?have=something-else');
    expect(other.body.map).not.toBeNull();
  });

  it('draws the map the notes view’s way only when asked, and still leaves it out on ?have=', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const plain = await call();
    expect(plain.body.map?.pencil).toBeUndefined();
    expect(plain.body).not.toHaveProperty('notes');
    const notes = await call('?view=notes');
    expect(notes.body.map?.pencil).toBe(true);
    expect(notes.body.notes?.words?.places.length).toBeGreaterThan(0);
    const held = await call(`?view=notes&have=${encodeURIComponent(recorded.terrainVersion)}`);
    expect(held.body.map).toBeNull();
    expect(held.body.notes?.words).not.toBeNull();
    // Any other view is ignored, and neither ever goes upstream.
    expect((await call('?view=%3Cscript%3E')).body.map?.pencil).toBeUndefined();
    for (const [u] of upstream.mock.calls) expect(String(u)).not.toMatch(/view|script/);
  });

  it('builds the place view’s model under glass instead of the map, and leaves it out on ?have=', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const place = await call('?view=place');
    expect(place.body.map).toBeNull();
    expect(place.body.glass?.version).toBe(recorded.terrainVersion);
    expect(place.body.mapVersion).toBe(recorded.terrainVersion);
    expect(place.body.glass?.cards.length).toBeGreaterThan(2);
    expect(place.body.people).toHaveLength(2);
    const held = await call(`?view=place&have=${encodeURIComponent(recorded.terrainVersion)}`);
    expect(held.body.glass).toBeNull();
    expect(held.body.map).toBeNull();
    expect(held.body.people).toHaveLength(2);
    // The other views never carry it.
    expect((await call()).body).not.toHaveProperty('glass');
    expect((await call('?view=notes')).body).not.toHaveProperty('glass');
    for (const [u] of upstream.mock.calls) expect(String(u)).not.toMatch(/view|place/);
  });

  it('keeps the place view’s poll lean: the model only with the version it does not hold', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const full = JSON.stringify((await call('?view=place')).body).length;
    const held = JSON.stringify((await call(`?view=place&have=${encodeURIComponent(recorded.terrainVersion)}`)).body).length;
    const map = JSON.stringify((await call()).body).length;
    expect(held).toBeLessThan(full / 3);
    expect(held).toBeLessThan(map / 3);
  });

  it('sends no terrain, layers, relief or contour paths again on ?have=, in any view, however often it is asked', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const full = (await call()).body;
    const glass = (await call('?view=place')).body.glass!;
    const paths = [full.map!.seen, full.map!.relief, ...full.map!.layers.map((l) => l.d), ...glass.cards.map((c) => JSON.stringify(c)), glass.bands]
      .filter((d): d is string => !!d && d.length > 24)
      .map((d) => d.slice(0, 24));
    expect(paths.length).toBeGreaterThan(3);
    const have = `have=${encodeURIComponent(recorded.terrainVersion)}`;
    for (const q of [`?${have}`, `?view=notes&${have}`, `?view=place&${have}`]) {
      for (let i = 0; i < 3; i++) {
        const { res, body } = await call(q);
        const text = JSON.stringify(body);
        expect(body.map, q).toBeNull();
        expect(body.glass ?? null, q).toBeNull();
        expect(body).not.toHaveProperty('terrain');
        for (const d of paths) expect(text, q).not.toContain(d);
        expect(text.length, q).toBeLessThan(6_000);
        expect(res.headers.get('cache-control')).toBe('public, max-age=1, stale-while-revalidate=5');
      }
    }
  });

  it('ignores a malformed ?have= and never sends it upstream', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const { body } = await call('?have=%3Cscript%3E');
    expect(body.map).not.toBeNull();
    for (const [u] of upstream.mock.calls) expect(String(u)).not.toContain('script');
  });

  it('still answers 200 offline when Wildmind fails before any good read', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    upstream.mockImplementation(async () => new Response('nope', { status: 502 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { res, body } = await call();
    log.mockRestore();
    expect(res.status).toBe(200);
    expect(body.state).toBe('offline');
  });
});

describe('loadWildmind', () => {
  it('reads with a fixed GET: no redirects, a timeout, nothing from the visitor', async () => {
    await loadWildmind(new Date(), URL_);
    const [u, init] = upstream.mock.calls[0] as [URL, RequestInit];
    expect(String(u)).toBe(URL_);
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('asks with ?have= once it holds the terrain, and reuses it', async () => {
    const first = await loadWildmind(new Date(), URL_);
    const second = await loadWildmind(new Date(), URL_);
    expect(String(upstream.mock.calls[1][0])).toContain(`have=${encodeURIComponent(recorded.terrainVersion)}`);
    expect(second?.terrain).toBe(first?.terrain);
    expect(second?.snap).not.toHaveProperty('terrain');
  });

  it('asks again in full when a terrain-less answer is for a version it does not hold', async () => {
    upstream.mockImplementationOnce(async () => new Response(JSON.stringify(withoutTerrain())));
    const read = await loadWildmind(new Date(), URL_);
    expect(upstream).toHaveBeenCalledTimes(2);
    expect(String(upstream.mock.calls[1][0])).not.toContain('have=');
    expect(read?.terrain.w).toBe(141);
  });

  it('lets go of the body of an answer it refuses', async () => {
    const cancel = vi.fn();
    upstream.mockImplementationOnce(async () => {
      const body = new ReadableStream({ cancel, pull: (c) => c.enqueue(new TextEncoder().encode('busy')) });
      return new Response(body, { status: 503 });
    });
    await expect(loadWildmind(new Date(), URL_)).rejects.toThrow(/status 503/);
    expect(cancel).toHaveBeenCalled();
  });

  it('traces the terrain inside the read, so a request never traces on its own', async () => {
    const read = await loadWildmind(new Date(), URL_);
    expect(read?.traced?.map.version).toBe(recorded.terrainVersion);
    expect(read?.traced?.map.w).toBe(141);
  });

  it('refuses a body over the cap, a wrong version and a redirect', async () => {
    upstream.mockImplementationOnce(async () => new Response('x'.repeat(MAX_BYTES + 1)));
    await expect(loadWildmind(new Date(), URL_)).rejects.toThrow(/too large/);
    upstream.mockImplementationOnce(async () => new Response(JSON.stringify({ ...recorded, v: 2 })));
    await expect(loadWildmind(new Date(), URL_)).rejects.toThrow(/not a wildmind snapshot/);
    upstream.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed: redirect mode is set to error');
    });
    await expect(loadWildmind(new Date(), URL_)).rejects.toThrow(/redirect/);
  });
});

/**
 * The memo dates a read from when it lands (performance.now); held still
 * here so the synthetic clocks below are the only time that passes.
 */
const holdClock = () => {
  beforeEach(() => void vi.spyOn(performance, 'now').mockReturnValue(0));
  afterEach(() => vi.restoreAllMocks());
};
/** A read once any refresh behind the last request has landed: what the next request is answered with. */
const fresh = async (d: Date) => {
  await readWildmind(d);
  await readWildmind.settled();
  return readWildmind(d);
};

describe('readWildmind', () => {
  const at = (ms: number) => new Date(Date.parse('2026-10-10T12:00:00Z') + ms);
  holdClock();

  it('asks Wildmind at most about once a second, however many read at once', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    expect(TTL_MS).toBeLessThan(1_000);
    expect(TTL_MS).toBeGreaterThanOrEqual(500);
    // A crowd in the same instant shares one read.
    await Promise.all(Array.from({ length: 50 }, () => readWildmind(at(0))));
    expect(upstream).toHaveBeenCalledTimes(1);
    // Within the TTL, still that one.
    await Promise.all(Array.from({ length: 20 }, (_, i) => readWildmind(at((i * (TTL_MS - 1)) / 20))));
    expect(upstream).toHaveBeenCalledTimes(1);
    // A crowd polling every second for ten seconds: one read a second.
    for (let s = 1; s <= 10; s++) {
      await Promise.all(Array.from({ length: 30 }, (_, i) => readWildmind(at(s * 1_000 + i * 10))));
      await readWildmind.settled();
    }
    expect(upstream).toHaveBeenCalledTimes(11);
  });

  it('never keeps a request waiting on a slow Wildmind once warm, and reads behind it', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    expect(STALE_MS).toBeGreaterThan(TTL_MS);
    const warm = await fresh(at(0));
    expect(warm?.snap.status).toBe('running');
    // Wildmind turns slow (longer than the page budget).
    const quick = upstream.getMockImplementation() as (input: URL | string) => Promise<Response>;
    upstream.mockImplementation(async (input: URL | string) => {
      await new Promise((r) => setTimeout(r, 600));
      return quick(input);
    });
    const started = Date.now();
    // Past the TTL: answered from the warm read at once while the next is fetched.
    expect(await readWildmind(at(2_000))).toBe(warm);
    // A page render a moment later, within the TTL of that request: no wait, no second read.
    expect((await wildmindShowcase(at(2_100), null, 'place'))?.state).toBeDefined();
    expect(await readWildmind(at(2_500))).toBe(warm);
    expect(Date.now() - started).toBeLessThan(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    await readWildmind.settled();
    const next = await readWildmind(at(2_600));
    expect(next).not.toBe(warm);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('leaves Wildmind alone for a minute after a failure, answering from the last good read', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const good = await fresh(at(0));
    expect(good?.snap.status).toBe('running');
    upstream.mockImplementation(async () => new Response('down', { status: 502 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await fresh(at(2_000))).toBe(good);
    expect(upstream).toHaveBeenCalledTimes(2);
    for (let t = 3_000; t < 2_000 + RETRY_MS; t += 1_000) expect(await readWildmind(at(t))).toBe(good);
    expect(upstream).toHaveBeenCalledTimes(2);
    await readWildmind(at(2_000 + RETRY_MS));
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
});

describe('the drawing, while the valley grows', () => {
  const at = (ms: number) => new Date(Date.parse('2026-10-10T12:00:00Z') + ms);
  holdClock();
  const [seed, explored, rev] = recorded.terrainVersion.split('.');
  /** Wildmind answering with a version that moves on with every read, as while they explore. */
  const exploring = (version: (n: number) => string) => {
    let n = 0;
    upstream.mockImplementation(async (input: URL | string) => {
      const v = version(n++);
      const have = new URL(String(input)).searchParams.get('have');
      const body = have === v ? { ...withoutTerrain(), terrainVersion: v } : { ...structuredClone(recorded), terrainVersion: v };
      return new Response(JSON.stringify(body));
    });
  };

  it('is drawn again at most once per DRAW_HOLD_MS while only the explored count moves', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    exploring((n) => `${seed}.${Number(explored) + n}.${rev}`);
    const drawn = new Set<string>();
    const traces = new Set<unknown>();
    const span = 60_000;
    for (let t = 0; t <= span; t += 1_000) {
      const read = await fresh(at(t));
      drawn.add(read!.snap.terrainVersion);
      traces.add(read!.traced);
      // The page is told the version drawn, and the map it is told of is that one.
      const page = await wildmindShowcase(at(t), null, 'place');
      expect(page?.mapVersion).toBe(read!.snap.terrainVersion);
      expect(page?.glass?.version).toBe(read!.snap.terrainVersion);
    }
    expect(upstream.mock.calls.length).toBeGreaterThan(50);
    expect(drawn.size).toBeLessThanOrEqual(Math.ceil(span / DRAW_HOLD_MS) + 1);
    expect(traces.size).toBe(drawn.size);
  });

  it('takes a new life or a changed ground at once', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const versions = [recorded.terrainVersion, `${seed}.${Number(explored) + 1}.${rev}`, `${Number(seed) + 1}.${explored}.${rev}`, `${Number(seed) + 1}.${explored}.${rev}x`];
    exploring((n) => versions[Math.min(n, versions.length - 1)]);
    const seen = [];
    for (let t = 0; t < 4_000; t += 1_000) seen.push((await fresh(at(t)))!.snap.terrainVersion);
    expect(seen).toEqual([versions[0], versions[0], versions[2], versions[3]]);
  });

  it('takes a grown valley at once when someone would stand off the held map', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const grown = `${seed}.${Number(explored) + 1}.${rev}`;
    let n = 0;
    upstream.mockImplementation(async () => {
      const body = structuredClone(recorded) as typeof recorded;
      if (n++) {
        body.terrainVersion = grown;
        body.people[0].x = body.terrain.origin[0] - 5;
      }
      return new Response(JSON.stringify(body));
    });
    expect((await fresh(at(0)))!.snap.terrainVersion).toBe(recorded.terrainVersion);
    expect((await fresh(at(1_000)))!.snap.terrainVersion).toBe(grown);
  });
});

describe('the local preview fixture', () => {
  it('stands in only in dev with the fixture flag and no address', async () => {
    h.dev = true;
    h.env.LANDING_SHOWCASE_FIXTURE = '1';
    const w = await wildmindShowcase(new Date());
    expect(w?.state).toBe('live');
    expect(w?.map?.w).toBe(141);
    expect(upstream).not.toHaveBeenCalled();
    h.env.LANDING_WILDMIND_STATE = 'between-lives';
    const ended = await wildmindShowcase(new Date());
    expect(ended?.state).toBe('between-lives');
    expect(ended?.people.find((p) => p.id === 'main')?.alive).toBe(false);
    h.env.LANDING_WILDMIND_STATE = 'offline';
    expect((await wildmindShowcase(new Date()))?.map).toBeNull();
  });

  it('is never used outside dev', async () => {
    h.env.LANDING_SHOWCASE_FIXTURE = '1';
    expect(await wildmindShowcase(new Date())).toBeNull();
  });

  it('takes a state pinned by a preview’s ?wm= for that browser alone, in dev with the fixture only', async () => {
    h.dev = true;
    h.env.LANDING_SHOWCASE_FIXTURE = '1';
    const mine = jar();
    expect(pinFixtureState(mine, 'paused', true)).toBe('paused');
    expect(mine.m.get(FIXTURE_COOKIE)).toBe('paused');
    // The page's polls carry the cookie; another browser on the same preview is untouched.
    expect((await call('', mine)).body.state).toBe('paused');
    expect((await call('', jar())).body.state).toBe('live');
    // A page load without ?wm= keeps the browser's pin.
    expect(pinFixtureState(mine, null, true)).toBe('paused');
    expect(pinFixtureState(mine, 'asleep', true)).toBe('asleep');
    const asleep = await wildmindShowcase(new Date(), null, 'place', pinnedFixtureState(mine));
    expect(asleep?.state).toBe('live');
    expect(asleep?.people.every((p) => p.doing === 'asleep')).toBe(true);
    expect(asleep?.glass?.cards.length).toBeGreaterThan(2);
    pinFixtureState(mine, 'young', true);
    const young = await wildmindShowcase(new Date(), null, 'place', pinnedFixtureState(mine));
    expect(young?.glass?.version).not.toBe(asleep?.glass?.version);
    // Unknown values are ignored; 'env' hands it back.
    expect(pinFixtureState(mine, '<script>', true)).toBe('young');
    expect(await wildmindShowcase(new Date(), null, null, '<script>')).toMatchObject({ state: 'live' });
    expect(pinFixtureState(mine, 'env', true)).toBeUndefined();
    expect(mine.m.has(FIXTURE_COOKIE)).toBe(false);
    // Outside dev it does nothing at all.
    h.dev = false;
    const prod = jar({ [FIXTURE_COOKIE]: 'offline' });
    expect(pinFixtureState(prod, 'offline', false)).toBeUndefined();
    expect(pinnedFixtureState(prod, false)).toBeUndefined();
  });
});
