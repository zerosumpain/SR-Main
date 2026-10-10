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
import { MAX_BYTES, RETRY_MS, TTL_MS, loadWildmind, pinFixtureState, readWildmind, resetWildmind, wildmindShowcase } from '$lib/landing/wildmind.server';
import type { WildmindShowcase } from '$lib/landing/wildmind';

const URL_ = 'http://wildmind.test:5397/api/public/snapshot';
const call = async (q = '') => {
  const res = await GET({ url: new URL(`http://site.test/api/landing/wildmind${q}`) } as never);
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

describe('readWildmind', () => {
  const at = (ms: number) => new Date(Date.parse('2026-10-10T12:00:00Z') + ms);

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
    for (let s = 1; s <= 10; s++) await Promise.all(Array.from({ length: 30 }, (_, i) => readWildmind(at(s * 1_000 + i * 10))));
    expect(upstream).toHaveBeenCalledTimes(11);
  });

  it('leaves Wildmind alone for a minute after a failure, answering from the last good read', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const good = await readWildmind(at(0));
    expect(good?.snap.status).toBe('running');
    upstream.mockImplementation(async () => new Response('down', { status: 502 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readWildmind(at(2_000))).toBe(good);
    expect(upstream).toHaveBeenCalledTimes(2);
    for (let t = 3_000; t < 2_000 + RETRY_MS; t += 1_000) expect(await readWildmind(at(t))).toBe(good);
    expect(upstream).toHaveBeenCalledTimes(2);
    await readWildmind(at(2_000 + RETRY_MS));
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(2);
    log.mockRestore();
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

  it('takes a state pinned by a preview’s ?wm=, in dev with the fixture only', async () => {
    h.dev = true;
    h.env.LANDING_SHOWCASE_FIXTURE = '1';
    pinFixtureState('paused', true);
    expect((await wildmindShowcase(new Date()))?.state).toBe('paused');
    pinFixtureState('asleep', true);
    const asleep = await wildmindShowcase(new Date(), null, 'place');
    expect(asleep?.state).toBe('live');
    expect(asleep?.people.every((p) => p.doing === 'asleep')).toBe(true);
    expect(asleep?.glass?.cards.length).toBeGreaterThan(2);
    pinFixtureState('young', true);
    const young = await wildmindShowcase(new Date(), null, 'place');
    expect(young?.glass?.version).not.toBe(asleep?.glass?.version);
    // Unknown values are ignored; 'env' hands it back.
    pinFixtureState('<script>', true);
    expect((await wildmindShowcase(new Date()))?.mapVersion).toBe(young?.mapVersion);
    pinFixtureState('env', true);
    expect((await wildmindShowcase(new Date()))?.state).toBe('live');
    // Outside dev it does nothing at all.
    h.dev = false;
    pinFixtureState('offline', false);
    h.dev = true;
    expect((await wildmindShowcase(new Date()))?.state).toBe('live');
  });
});
