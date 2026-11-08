import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import recorded from '$lib/landing/fixtures/wildmind-day16.json';

// The real owner gate (`withDevice`) in front of the route, over the real
// memoised read (readWildmind) with Wildmind's listener stubbed as `fetch`.

const OWNER = 'owner@example.test';

const h = vi.hoisted(() => ({
  identity: null as null | { id: string; ownerEmail: string; label: string | null; expiresAt: Date },
  env: {} as Record<string, string | undefined>,
  dev: false,
  members: new Map<string, { principalId: string; grants: Set<string> }>(),
}));

vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('$app/environment', () => ({
  get dev() {
    return h.dev;
  },
}));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => h.identity,
  touchDevice: async () => {},
}));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase() === OWNER }));
vi.mock('$lib/server/grants', () => ({ loadMember: async (e: string) => h.members.get(e) ?? null }));
vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => null }));
vi.mock('$lib/jkai/chat/job-store', () => ({ getJob: () => null }));

const { GET } = await import('./+server');
const { resetWildmind } = await import('$lib/landing/wildmind.server');
const { doingOf } = await import('$lib/landing/wildmind');

const URL_ = 'http://wildmind.test:5397/api/public/snapshot';
const VERSION = recorded.terrainVersion;
const SECRET = 'I am thinking about the wolves again';

async function call(query = '') {
  const url = new URL(`https://site.test/api/native/wildmind${query}`);
  const request = new Request(url, { headers: { authorization: `Bearer ${'x'.repeat(43)}` } });
  const res = await (GET as unknown as (e: unknown) => Promise<Response>)({ request, url, locals: { auth: async () => null } });
  return { res, body: await res.json() };
}

function device(email: string) {
  return { id: `dev-${email}`, ownerEmail: email, label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
}

/** The recorded snapshot, with free text planted where a careless Wildmind might send it. */
function planted(withTerrain: boolean): Record<string, unknown> {
  const o = structuredClone(recorded) as unknown as Record<string, any>;
  Object.assign(o, { lastThought: SECRET, speech: SECRET, extra: { nested: SECRET } });
  Object.assign(o.people[0], { lastThought: SECRET, activityLabel: `Exploring ${SECRET}`, mood: SECRET, speech: { text: SECRET }, plan: [SECRET] });
  Object.assign(o.stats, { analysis: SECRET, description: SECRET });
  Object.assign(o.stats.latest[0], { description: SECRET, rationale: SECRET, refereeNotes: SECRET });
  Object.assign(o.time, { story: SECRET });
  Object.assign(o.terrain, { notes: SECRET });
  Object.assign(o.terrain.regions[0], { description: SECRET });
  if (!withTerrain) delete o.terrain;
  return o;
}

let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  for (const k of Object.keys(h.env)) delete h.env[k];
  h.env.AUTH_ALLOWED_EMAILS = OWNER;
  h.dev = false;
  h.identity = null;
  h.members.clear();
  resetWildmind();
  upstream = vi.fn(async (input: URL | string) => {
    const u = new URL(String(input));
    const body = planted(u.searchParams.get('have') !== VERSION);
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/native/wildmind', () => {
  it('401s an unpaired phone, without reading Wildmind', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    const { res, body } = await call();
    expect(res.status).toBe(401);
    expect(body).toEqual({ error: 'Pair this iPhone again.' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("403s a member's phone, without reading Wildmind", async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    h.identity = device('ann@example.test');
    h.members.set('ann@example.test', { principalId: 'u_ann', grants: new Set(['news:self', 'games:self']) });
    const { res } = await call();
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers the owner offline, asking nobody, when Wildmind is not configured', async () => {
    h.identity = device(OWNER);
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(body).toEqual({ state: 'offline', ageSeconds: null, snapshot: null, terrain: null });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('ignores the preview fixture flag outside dev', async () => {
    h.identity = device(OWNER);
    h.env.LANDING_SHOWCASE_FIXTURE = '1';
    const { body } = await call();
    expect(body.state).toBe('offline');
  });

  it('serves the recorded fixture in a local preview, with its terrain', async () => {
    h.identity = device(OWNER);
    h.dev = true;
    h.env.LANDING_SHOWCASE_FIXTURE = '1';
    const { body } = await call();
    expect(body.state).toBe('live');
    expect(body.snapshot.terrainVersion).toBe(VERSION);
    expect(body.snapshot).not.toHaveProperty('terrain');
    expect(body.terrain.w * body.terrain.h).toBe(Buffer.from(body.terrain.t, 'base64').length);
    expect(upstream).not.toHaveBeenCalled();
    expect((await call(`?have=${VERSION}`)).body.terrain).toBeNull();
  });

  it('answers the owner with the whole snapshot and the terrain beside it', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    h.identity = device(OWNER);
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['ageSeconds', 'snapshot', 'state', 'terrain']);
    expect(body.state).toBe('live');
    expect(body.ageSeconds).toBe(0);
    const s = body.snapshot;
    expect(s).not.toHaveProperty('terrain');
    expect(s.terrainVersion).toBe(VERSION);
    expect(Object.keys(s.time).sort()).toEqual(['day', 'dayOfSeason', 'daylight', 'hour', 'season', 'tempC', 'weather']);
    expect(s.people.map((p: { name: string }) => p.name)).toEqual(['JKai', 'Wren']);
    for (const p of s.people) {
      expect(Object.keys(p).sort()).toEqual(['activity', 'alive', 'doing', 'heading', 'id', 'morale', 'name', 'near', 'thinking', 'trail', 'x', 'z']);
      expect(p.doing).toBe(doingOf(p));
    }
    expect(s.animals.length).toBe(recorded.animals.length);
    expect(s.structures.length).toBe(recorded.structures.length);
    expect(Object.keys(s.stats)).toEqual(
      expect.arrayContaining(['generation', 'earlierLives', 'invented', 'latest', 'models', 'milestones', 'built', 'tamed', 'choices']),
    );
    expect(Object.keys(body.terrain).sort()).toEqual(['h', 'height', 'origin', 'regions', 'step', 't', 'terrains', 'w']);
    expect(body.terrain.w).toBe(recorded.terrain.w);
    expect(body.terrain.t).toBe(recorded.terrain.t);
    expect(body.terrain.height).toBe(recorded.terrain.height);
  });

  it('leaves the terrain out when ?have= names the version held, and only then', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    h.identity = device(OWNER);
    const held = await call(`?have=${encodeURIComponent(VERSION)}`);
    expect(held.body.terrain).toBeNull();
    expect(held.body.snapshot.terrainVersion).toBe(VERSION);
    expect((await call('?have=1.2.3')).body.terrain).not.toBeNull();
    expect((await call(`?have=${'9'.repeat(65)}`)).body.terrain).not.toBeNull();
    expect((await call('?have=%3Cscript%3E')).body.terrain).not.toBeNull();
    // Nothing from the phone goes upstream: the memo asks with its own held version.
    for (const [input] of upstream.mock.calls) expect(new URL(String(input)).searchParams.get('have') ?? VERSION).toBe(VERSION);
  });

  it('never carries free text, even when Wildmind sends it', async () => {
    h.env.WILDMIND_SNAPSHOT_URL = URL_;
    h.identity = device(OWNER);
    const { body } = await call();
    const out = JSON.stringify(body);
    expect(out).not.toContain('wolves again');
    for (const k of ['lastThought', 'activityLabel', 'mood', 'speech', 'plan', 'analysis', 'description', 'rationale', 'refereeNotes', 'story', 'notes', 'extra'])
      expect(out).not.toContain(`"${k}"`);
  });
});
