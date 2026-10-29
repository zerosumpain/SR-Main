import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { env } from '$env/dynamic/private';

/**
 * The desk's Today endpoint: Core reads "Needs you" from here, since its role
 * cannot read Main's commissions or deliveries. 401 without the token, the
 * desk's sections in a fixed shape, and one section failing alone.
 * Every fixture is synthetic.
 */

const h = vi.hoisted(() => ({ fail: new Set<string>(), newsCalled: false }));
const maybe = <T>(key: string, v: T): Promise<T> => (h.fail.has(key) ? Promise.reject(new Error(`${key} down`)) : Promise.resolve(v));

const delivery = (stage: string, extra: Record<string, unknown>) => ({
  version: 1,
  area: 'Platform',
  stage,
  brief: { revision: 1, outcome: '', constraints: '', routes: [], acceptedAt: '2026-10-27T10:00:00Z' },
  criteria: [],
  decisions: [],
  session: { engine: 'pi', id: null, file: null, recovery: null },
  candidate: null,
  gate: null,
  preview: { url: null, status: 'unavailable', detail: '' },
  batch: null,
  acceptedAt: null,
  releasePolicy: 'manual',
  ...extra,
});

vi.mock('$lib/db', () => {
  let joined = false;
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => { joined = false; return chain; },
    from: () => chain,
    innerJoin: () => { joined = true; return chain; },
    where: () => chain,
    orderBy: () => chain,
    limit: () =>
      joined
        ? maybe('deliveries', [
            { buildId: 'b-ask', title: 'Synthetic feature', prompt: 'p', state: delivery('needs_input', { decisions: [{ id: 'q1', question: 'Which colour?', answer: null }] }) },
            { buildId: 'b-busy', title: 'Busy', prompt: 'p', state: delivery('building', {}) },
            { buildId: 'b-rel', title: null, prompt: 'Release me\nmore', state: delivery('pr_open', { release: { revision: 'r', prUrl: 'https://example.test/pr/1', awaitingOwner: 'Protected path: needs your merge' } }) },
          ])
        : maybe('thread', [{ id: 'conv-1', title: 'Synthetic thread', updatedAt: new Date('2026-10-28T07:00:00Z') }]),
  });
  return { db: chain };
});
vi.mock('$lib/daydream/summary.server', () => ({
  loadDaydreamSummary: () =>
    maybe('summary', {
      counts: { waitingOnYou: 1, unrated: 12, inMotion: 2 },
      waiting: [{ id: 'n1', title: 'Synthetic note', reason: 'commission_needs_ok', reasonLabel: 'Double-check waiting for your OK', href: '/jkai/daydreams?note=n1' }],
      matched: [],
    }),
}));
vi.mock('$lib/daydream/hub-counts.server', () => ({
  loadHubCounts: () => maybe('summary', { notesToRate: 12, activeWatches: 0, think: { week: 3, useful30d: 0, rated30d: 0, lastCycleAt: new Date('2026-10-28T08:00:00Z') }, checks: { waiting: 1, running: 1 } }),
}));
vi.mock('$lib/briefing/dashboard.server', () => ({
  listBriefingDays: () => maybe('briefing', [{ id: '2026-10-28', title: '', startedAt: '', status: 'complete' }]),
  loadBriefingDay: async () => ({ id: '2026-10-28', title: 'Briefing — Wed 28 Oct', markdown: 'm', startedAt: '2026-10-28T06:00:00Z', detail: { headline: 'Synthetic headline', dateLabel: 'Wed 28 Oct', generatedAt: '2026-10-28T06:00:05Z', verification: { verified: true } } }),
}));
vi.mock('$lib/connectors/watch-store', () => ({ connectorAttention: () => maybe('connections', { items: [] }) }));
vi.mock('$lib/news/desk', () => ({ loadNewsDesk: () => { h.newsCalled = true; return Promise.resolve(null); } }));
vi.mock('$lib/server/native-health', () => ({ getNativeHealthSummary: () => Promise.reject(new Error('not asked')) }));
vi.mock('$lib/server/notify', () => ({ pendingForDevice: async () => [], recentEvents: async () => [] }));
vi.mock('$lib/daydream/think/notes.server', () => ({ loadTodayNotes: async () => [] }));

const { GET } = await import('./+server');

const TOKEN = 'c'.repeat(48);
const mutableEnv = env as Record<string, string | undefined>;
const original = env.JKAI_INVOKE_TOKEN;

beforeEach(() => {
  mutableEnv.JKAI_INVOKE_TOKEN = TOKEN;
  h.fail.clear();
  h.newsCalled = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  if (original === undefined) delete mutableEnv.JKAI_INVOKE_TOKEN;
  else mutableEnv.JKAI_INVOKE_TOKEN = original;
});

async function call(token?: string, query = '') {
  const url = new URL(`https://example.test/api/platform/jkai/today${query}`);
  const request = new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  try {
    return await GET({ request, url } as Parameters<typeof GET>[0]);
  } catch (e) {
    return e as { status: number };
  }
}

describe('GET /api/platform/jkai/today', () => {
  it('refuses a caller without the invoke token', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('x'.repeat(48))).status).toBe(401);
  });

  it("answers the desk's sections, and never reads news", async () => {
    const res = (await call(TOKEN)) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).toEqual(['generatedAt', 'connections', 'lastThread', 'needsYou', 'briefing']);
    expect(h.newsCalled).toBe(false);
    expect(body.needsYou).toEqual({
      daydream: {
        counts: { waitingOnYou: 1, unrated: 12, inMotion: 2 },
        waiting: [{ id: 'n1', title: 'Synthetic note', reason: 'commission_needs_ok', reasonLabel: 'Double-check waiting for your OK', href: '/jkai/daydreams?note=n1' }],
      },
      deliveries: [
        { id: 'b-ask', title: 'Synthetic feature', reason: 'question', detail: 'Which colour?', stage: 'needs_input', href: '/jkai/develop/b-ask', prUrl: null },
        { id: 'b-rel', title: 'Release me', reason: 'release', detail: 'Protected path: needs your merge', stage: 'pr_open', href: '/jkai/develop/b-rel', prUrl: 'https://example.test/pr/1' },
      ],
      checksRunning: 1,
      lastCycleAt: '2026-10-28T08:00:00.000Z',
    });
    expect(body.briefing).toEqual({
      day: '2026-10-28',
      title: 'Briefing — Wed 28 Oct',
      headline: 'Synthetic headline',
      dateLabel: 'Wed 28 Oct',
      generatedAt: '2026-10-28T06:00:05Z',
      verified: true,
      href: '/jkai/daydreams/briefing/2026-10-28',
    });
    expect(body.lastThread).toEqual({ id: 'conv-1', title: 'Synthetic thread', updatedAt: '2026-10-28T07:00:00.000Z' });
    expect(body.connections).toEqual({ needsAttention: 0, items: [] });
  });

  it('lets one section fail alone', async () => {
    h.fail.add('summary');
    const body = await ((await call(TOKEN)) as Response).json();
    expect(body.needsYou).toBeNull();
    expect(body.briefing).not.toBeNull();
    expect(body.lastThread).not.toBeNull();
    expect(console.error).toHaveBeenCalledWith('[today] needsYou unavailable', expect.any(Error));
  });

  it('narrows to the sections asked for and ignores unknown names', async () => {
    const body = await ((await call(TOKEN, '?sections=briefing,bogus')) as Response).json();
    expect(Object.keys(body)).toEqual(['generatedAt', 'briefing']);
  });
});
