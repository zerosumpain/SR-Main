import { beforeEach, describe, expect, it, vi } from 'vitest';

// v6 on the site: ideas and conversation turns may run as jobs; the session
// that started one polls GET /api/trips/jobs/:jobId; the sync path is unchanged.
const h = vi.hoisted(() => ({ email: 'owner@example.test' as string | null }));

vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test', getOwnerEmails: () => ['owner@example.test'] }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => false }));
vi.mock('$lib/trips/store.server', () => ({ getTrip: async (_o: string, id: string) => (id === 't1' ? { id: 't1', ownerEmail: 'owner@example.test' } : null) }));
vi.mock('$lib/trips/converse.server', () => ({ converse: async (_t: unknown, input: { text: string }) => ({ reply: `heard ${input.text}` }) }));
vi.mock('$lib/trips/ideas.server', () => ({ findIdeas: async (_t: unknown, ask: unknown) => ({ ideas: [], ask }) }));

const talk = await import('./[id]/converse/+server');
const ideas = await import('./[id]/ideas/+server');
const jobs = await import('./jobs/[jobId]/+server');

function ev(params: Record<string, string>, body?: unknown) {
  return {
    params,
    locals: { auth: async () => (h.email ? { user: { email: h.email } } : null) },
    getClientAddress: () => '100.83.68.1',
    request: new Request('http://x/api/trips', body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  } as never;
}
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  h.email = 'owner@example.test';
});

describe('site jobs', () => {
  it('the sync path is unchanged', async () => {
    expect(await (await talk.POST(ev({ id: 't1' }, { text: 'hi' }))).json()).toEqual({ reply: 'heard hi' });
  });

  it('a conversation turn and an ideas ask run as jobs the session polls', async () => {
    const t = await talk.POST(ev({ id: 't1' }, { text: 'hi', async: true }));
    expect(t.status).toBe(202);
    const i = await ideas.POST(ev({ id: 't1' }, { date: '2026-10-28', stage: 'lunch', async: true }));
    expect(i.status).toBe(202);
    await settle();
    const tj = (await t.json()).job;
    const ij = (await i.json()).job;
    expect((await (await jobs.GET(ev({ jobId: tj.id }))).json()).job).toMatchObject({ kind: 'converse', status: 'done', result: { reply: 'heard hi' } });
    expect((await (await jobs.GET(ev({ jobId: ij.id }))).json()).job).toMatchObject({ kind: 'ideas', status: 'done', result: { ideas: [] } });
    expect((await jobs.GET(ev({ jobId: 'nope' }))).status).toBe(404);
  });

  it('nobody but the owner polls', async () => {
    h.email = 'kid@example.test';
    await expect(jobs.GET(ev({ jobId: 'x' }))).rejects.toMatchObject({ status: 403 });
  });
});
