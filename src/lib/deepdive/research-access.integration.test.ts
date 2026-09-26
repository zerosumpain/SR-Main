import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityPrincipals, allowedUser, researchSessions, sources } from '$lib/db/schema';

// The P3 proof: real sessions owned by the owner, member A (research:self) and
// household; real member rows resolved by the real seam; the real handlers.
// A member never gets the owner's run from any route, a reader at `all` sees
// A's but cannot change it, and the cap refuses what it should.
//
// Touches only rows it creates (tagged), and deletes them after. No run is
// started: the worker is mocked, so no model or search is ever called.

vi.mock('$lib/deepdive/worker', () => ({
  startResearch: vi.fn(),
  isRunning: () => false,
  getEmitter: () => ({ on: () => {}, off: () => {} }),
  requestStop: vi.fn(),
  requestSkipPhase: vi.fn(),
  requestPause: vi.fn(),
}));

const TAG = `r${Math.random().toString(36).slice(2, 10)}`;
const OWNER_SECRET = `Ownerrun${TAG}`;
const A_WORD = `Memberrun${TAG}`;
const A_EMAIL = `a-${TAG}@example.test`;
const B_EMAIL = `b-${TAG}@example.test`;
const C_EMAIL = `c-${TAG}@example.test`;
const A = `u_a${TAG}`;
const B = `u_b${TAG}`;
const C = `u_c${TAG}`;
const ids: Record<string, string> = {};

function event(email: string | null, opts: { url?: string; params?: Record<string, string>; method?: string; body?: unknown } = {}) {
  const url = new URL(opts.url ?? 'http://test.local/');
  return {
    url,
    request: new Request(url, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    params: opts.params ?? {},
    route: { id: null },
    locals: { auth: async () => (email ? { user: { email } } : null) },
    fetch,
    parent: async () => ({}),
    depends: () => {},
    setHeaders: () => {},
    getClientAddress: () => '203.0.113.9',
    cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, serialize: () => '' },
  } as any;
}

async function run<T>(fn: () => Promise<T> | T): Promise<{ status: number; body: unknown }> {
  try {
    const out = await fn();
    if (out instanceof Response) {
      const text = await out.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      return { status: out.status, body };
    }
    return { status: 200, body: out };
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') return { status, body: (err as { body?: unknown; location?: string }).body ?? (err as { location?: string }).location };
    throw err;
  }
}

const leaks = (body: unknown) =>
  [OWNER_SECRET, ids.owner, ids.ownerSource].filter((s) => s && JSON.stringify(body ?? null).includes(s));

describe.skipIf(!process.env.DATABASE_URL)('research is scoped to the reader', () => {
  beforeAll(async () => {
    await db.insert(allowedUser).values([
      { email: A_EMAIL, grants: ['research:self'], note: 'research-access.integration' },
      { email: B_EMAIL, grants: ['research:all'], note: 'research-access.integration' },
      { email: C_EMAIL, grants: ['news:self'], note: 'research-access.integration' },
    ]);
    await db.insert(activityPrincipals).values([
      { id: A, kind: 'user', externalRef: A_EMAIL, label: 'test a' },
      { id: B, kind: 'user', externalRef: B_EMAIL, label: 'test b' },
      { id: C, kind: 'user', externalRef: C_EMAIL, label: 'test c' },
    ]);
    const base = { status: 'complete', depth: 'brief' } as const;
    const [owner] = await db.insert(researchSessions).values({ ...base, topic: `${OWNER_SECRET} topic` }).returning({ id: researchSessions.id });
    const [mine] = await db.insert(researchSessions).values({ ...base, topic: `${A_WORD} topic`, principalId: A }).returning({ id: researchSessions.id });
    const [shared] = await db.insert(researchSessions).values({ ...base, topic: `Shared${TAG}`, principalId: 'household' }).returning({ id: researchSessions.id });
    ids.owner = owner.id;
    ids.mine = mine.id;
    ids.shared = shared.id;
    const [src] = await db
      .insert(sources)
      .values({ sessionId: owner.id, url: `https://example.test/${TAG}`, title: `${OWNER_SECRET} source`, phase: 1 })
      .returning({ id: sources.id });
    ids.ownerSource = src.id;
  });

  afterAll(async () => {
    const principals = [A, B, C];
    await db.delete(sources).where(eq(sources.sessionId, ids.owner ?? ''));
    await db.delete(researchSessions).where(inArray(researchSessions.principalId, principals));
    await db.delete(researchSessions).where(inArray(researchSessions.id, [ids.owner, ids.mine, ids.shared].filter(Boolean)));
    await db.delete(activityPrincipals).where(inArray(activityPrincipals.id, principals));
    await db.delete(allowedUser).where(inArray(allowedUser.email, [A_EMAIL, B_EMAIL, C_EMAIL]));
  });

  it('lists: a self reader sees own + household, never the owner run', async () => {
    const page = await import('../../routes/research/+page.server');
    const res = await run(() => page.load(event(A_EMAIL)));
    expect(res.status).toBe(200);
    const topics = JSON.stringify(res.body);
    expect(topics).toContain(A_WORD);
    expect(topics).toContain(`Shared${TAG}`);
    expect(leaks(res.body)).toEqual([]);

    const api = await import('../../routes/api/research/+server');
    const listed = await run(() => api.GET(event(A_EMAIL, { url: 'http://test.local/api/research?limit=100' })));
    expect(leaks(listed.body)).toEqual([]);
  });

  it("by id: the owner's run is not found on every route a member can reach", async () => {
    const e = (url = 'http://test.local/') => event(A_EMAIL, { url, params: { id: ids.owner } });
    const cases: Array<[string, () => Promise<unknown>]> = [
      ['deepdive GET', async () => (await import('../../routes/api/deepdive/[id]/+server')).GET(e())],
      ['data', async () => (await import('../../routes/api/deepdive/[id]/data/+server')).GET(e())],
      ['report', async () => (await import('../../routes/api/deepdive/[id]/report/+server')).GET(e())],
      ['export md', async () => (await import('../../routes/api/deepdive/[id]/export/md/+server')).GET(e())],
      ['network', async () => (await import('../../routes/api/research/[id]/network/+server')).GET(e())],
      ['spend', async () => (await import('../../routes/api/research/[id]/spend/+server')).GET(e('http://test.local/?account=1'))],
      ['narrative', async () => (await import('../../routes/api/deepdive/[id]/narrative/+server')).GET(e())],
    ];
    for (const [name, call] of cases) {
      const res = await run(call);
      expect(res.status, name).toBe(404);
      expect(leaks(res.body), name).toEqual([]);
    }

    const page = await import('../../routes/research/[id]/+page.server');
    const res = await run(() => page.load(e()));
    expect(res.status).toBe(302); // back to /research, as for a run that does not exist

    const source = await import('../../routes/api/research/source/[id]/+server');
    const src = await run(() => source.GET(event(A_EMAIL, { params: { id: ids.ownerSource } })));
    expect(src.status).toBe(404);
    expect(leaks(src.body)).toEqual([]);
  });

  it('writes: deleting the owner run deletes nothing; their own is theirs', async () => {
    const api = await import('../../routes/api/research/+server');
    const res = await run(() => api.DELETE(event(A_EMAIL, { method: 'DELETE', body: { ids: [ids.owner] } })));
    expect(res.body).toMatchObject({ deleted: 0 });
    const [still] = await db.select({ id: researchSessions.id }).from(researchSessions).where(eq(researchSessions.id, ids.owner));
    expect(still?.id).toBe(ids.owner);
  });

  it("an `all` reader reads A's run but may not change it", async () => {
    const one = await import('../../routes/api/deepdive/[id]/+server');
    const read = await run(() => one.GET(event(B_EMAIL, { params: { id: ids.mine } })));
    expect(read.status).toBe(200);
    expect(JSON.stringify(read.body)).toContain(A_WORD);
    const del = await run(() => one.DELETE(event(B_EMAIL, { method: 'DELETE', params: { id: ids.mine } })));
    expect(del.status).toBe(403);
    expect((await run(() => one.GET(event(B_EMAIL, { params: { id: ids.owner } })))).status).toBe(404);
  });

  it('a member without research is refused outright', async () => {
    const page = await import('../../routes/research/+page.server');
    expect((await run(() => page.load(event(C_EMAIL)))).status).toBe(403);
  });

  it('creates: stamps the member, refuses investigation, and caps the day', async () => {
    const api = await import('../../routes/api/research/+server');
    const deep = await run(() => api.POST(event(A_EMAIL, { body: { topic: `deep ${TAG}`, depth: 'investigation' } })));
    expect(deep.status).toBe(403);

    // A already owns one run from today (the seeded one).
    for (let i = 0; i < 4; i++) {
      const res = await run(() => api.POST(event(A_EMAIL, { body: { topic: `brief ${i} ${TAG}`, depth: 'brief' } })));
      expect(res.status, `run ${i}`).toBe(201);
      expect((res.body as { principalId: string }).principalId).toBe(A);
    }
    const sixth = await run(() => api.POST(event(A_EMAIL, { body: { topic: `one too many ${TAG}`, depth: 'brief' } })));
    expect(sixth.status).toBe(429);

    const child = await run(() =>
      api.POST(event(B_EMAIL, { body: { topic: `child ${TAG}`, depth: 'scan', parentSessionId: ids.owner } })),
    );
    expect(child.status).toBe(404);

    const rows = await db
      .select({ n: researchSessions.id })
      .from(researchSessions)
      .where(and(eq(researchSessions.principalId, A)));
    expect(rows.length).toBe(5);
  });
});
