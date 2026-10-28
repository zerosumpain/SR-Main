import { beforeEach, describe, expect, it, vi } from 'vitest';

// The phone's first screen behind the real owner gate (`withDevice`), with
// every source stubbed. It pins the response byte for byte, so moving the
// loader into `$lib/today` (overhaul slice 4) cannot change what an installed
// app decodes. Every fixture is synthetic.

const OWNER = 'owner@example.test';

const h = vi.hoisted(() => ({
  identity: null as null | { id: string; ownerEmail: string; label: string | null; expiresAt: Date },
  env: {} as Record<string, string | undefined>,
  fail: new Set<string>(),
  newsOwner: '' as string,
  freshArg: null as unknown,
}));

const maybe = <T>(key: string, value: T): Promise<T> =>
  h.fail.has(key) ? Promise.reject(new Error(`${key} down`)) : Promise.resolve(value);

vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$lib/db', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => maybe('thread', [{ id: 'conv-1', title: 'Synthetic thread', updatedAt: new Date('2026-10-28T07:00:00Z') }]),
  };
  return { db: chain };
});
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => h.identity,
  touchDevice: async () => {},
}));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase() === OWNER }));
vi.mock('$lib/server/grants', () => ({ loadMember: async () => null }));
vi.mock('$lib/server/native-health', () => ({
  getNativeHealthSummary: (opts: unknown) => {
    h.freshArg = opts;
    return maybe('health', {
      isMock: false,
      strap: 'Synthetic strap',
      readiness: { score: 71, label: 'Ready' },
      figures: [{ key: 'hrv', label: 'HRV', value: '52', series: [1, 2, 3] }],
      generatedAt: '2026-10-28T06:30:00.000Z',
    });
  },
}));
vi.mock('$lib/server/notify', () => ({
  pendingForDevice: () => maybe('alerts', [{ id: 'p1' }, { id: 'p2' }]),
  recentEvents: () =>
    maybe('alerts', [
      { id: 'e1', category: 'daydream', title: 'Synthetic alert', severity: 'info', createdAt: new Date('2026-10-28T05:00:00Z'), readAt: null },
      { id: 'e2', category: 'build', title: 'Second', severity: 'warn', createdAt: new Date('2026-10-28T04:00:00Z'), readAt: new Date() },
      { id: 'e3', category: 'x', title: 'Third', severity: 'info', createdAt: new Date('2026-10-28T03:00:00Z'), readAt: null },
      { id: 'e4', category: 'x', title: 'Fourth', severity: 'info', createdAt: new Date('2026-10-28T02:00:00Z'), readAt: null },
    ]),
}));
vi.mock('$lib/news/desk', () => ({
  loadNewsDesk: (opts: { ownerKey: string }) => {
    h.newsOwner = opts.ownerKey;
    return maybe('news', {
      feed: {
        updatedAt: '2026-10-28T06:00:00.000Z',
        newSinceLast: 4,
        stories: [1, 2, 3, 4].map((n) => ({ key: `k${n}`, title: `Story ${n}`, sourceLabel: 'HN', url: `https://example.test/${n}`, heat: n, extra: 'dropped' })),
      },
    });
  },
}));
vi.mock('$lib/connectors/watch-store', () => ({
  connectorAttention: () => maybe('connections', { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] }),
}));
vi.mock('$lib/daydream/think/notes.server', () => ({
  loadTodayNotes: () => maybe('daydream', [{ id: 'n1', title: 'Synthetic note' }]),
}));

const route = await import('./+server');
type Handler = (e: unknown) => Promise<Response>;

async function get(query = '', auth = true) {
  const url = new URL(`https://site.test/api/native/today${query}`);
  const request = new Request(url, { headers: auth ? { authorization: `Bearer ${'x'.repeat(43)}` } : {} });
  const res = await (route.GET as unknown as Handler)({ request, url, locals: { auth: async () => null } });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  for (const k of Object.keys(h.env)) delete h.env[k];
  h.env.AUTH_ALLOWED_EMAILS = OWNER;
  h.identity = { id: 'dev-1', ownerEmail: OWNER, label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
  h.fail.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('GET /api/native/today', () => {
  it('refuses an unpaired phone and a member phone', async () => {
    h.identity = null;
    expect((await get('', false)).status).toBe(401);
    h.identity = { id: 'dev-2', ownerEmail: 'ann@example.test', label: 'iPhone', expiresAt: new Date('2027-01-01T00:00:00Z') };
    expect((await get()).status).toBe(403);
  });

  it('answers the first screen in the contract shape', async () => {
    const { status, body } = await get('?fresh=1');
    expect(status).toBe(200);
    expect(h.freshArg).toEqual({ fresh: true });
    expect(h.newsOwner).toBe(OWNER);
    expect(typeof body.generatedAt).toBe('string');
    expect(Object.keys(body)).toEqual(['generatedAt', 'health', 'alerts', 'news', 'connections', 'daydream', 'lastThread']);
    const { generatedAt: _g, ...rest } = body;
    expect(rest).toEqual({
      health: {
        isMock: false,
        strap: 'Synthetic strap',
        readiness: { score: 71, label: 'Ready' },
        figures: [{ key: 'hrv', label: 'HRV', value: '52' }],
        generatedAt: '2026-10-28T06:30:00.000Z',
      },
      alerts: {
        pending: 2,
        unread: 3,
        latest: [
          { id: 'e1', category: 'daydream', title: 'Synthetic alert', severity: 'info', createdAt: '2026-10-28T05:00:00.000Z' },
          { id: 'e2', category: 'build', title: 'Second', severity: 'warn', createdAt: '2026-10-28T04:00:00.000Z' },
          { id: 'e3', category: 'x', title: 'Third', severity: 'info', createdAt: '2026-10-28T03:00:00.000Z' },
        ],
      },
      news: {
        updatedAt: '2026-10-28T06:00:00.000Z',
        unseen: 4,
        stories: [1, 2, 3].map((n) => ({ key: `k${n}`, title: `Story ${n}`, sourceLabel: 'HN', url: `https://example.test/${n}`, heat: n })),
      },
      connections: { needsAttention: 4, items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
      daydream: { notes: [{ id: 'n1', title: 'Synthetic note' }] },
      lastThread: { id: 'conv-1', title: 'Synthetic thread', updatedAt: '2026-10-28T07:00:00.000Z' },
    });
  });

  it('degrades each card on its own', async () => {
    for (const k of ['health', 'alerts', 'news', 'connections', 'daydream', 'thread']) h.fail.add(k);
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(h.freshArg).toEqual({ fresh: false });
    const { generatedAt: _g, ...rest } = body;
    expect(rest).toEqual({ health: null, alerts: null, news: null, connections: null, daydream: null, lastThread: null });
    expect(console.error).toHaveBeenCalledWith('[native] today: health unavailable', expect.any(Error));
    expect(console.error).toHaveBeenCalledWith('[native] today: daydream notes unavailable', expect.any(Error));
  });
});
