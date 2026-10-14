import { beforeEach, describe, expect, it, vi } from 'vitest';

// The site route: only the owner's session reaches it.
const h = vi.hoisted(() => ({ email: null as string | null }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test', getOwnerEmails: () => ['owner@example.test'] }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => false }));
vi.mock('$lib/trips/store.server', () => ({ getTrip: async (owner: string) => (owner === 'owner@example.test' ? { id: 't1' } : null) }));
vi.mock('$lib/trips/ideas.server', () => ({ findIdeas: async (_t: unknown, ask: unknown) => ({ ideas: [], ask }) }));
vi.mock('$lib/trips/plan.server', () => ({ replan: async () => ({ plan: { version: 1 }, created: false }) }));
vi.mock('$lib/trips/converse.server', () => ({ logEdit: async () => {} }));

const route = await import('./+server');
const ev = (body: unknown) =>
  ({
    params: { id: '11111111-1111-4111-8111-111111111111' },
    locals: { auth: async () => (h.email ? { user: { email: h.email } } : null) },
    getClientAddress: () => '203.0.113.9',
    request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }),
  }) as never;
const status = async (p: Response | Promise<Response>) => {
  try {
    return (await p).status;
  } catch (err) {
    return (err as { status: number }).status;
  }
};

beforeEach(() => (h.email = null));

describe('POST /api/trips/:id/ideas', () => {
  it('refuses anyone but the owner', async () => {
    expect(await status(route.POST(ev({ date: '2026-10-28', stage: 'afternoon' })))).toBe(403);
    h.email = 'kid@example.test';
    expect(await status(route.POST(ev({ date: '2026-10-28', stage: 'afternoon' })))).toBe(403);
  });
  it('answers the owner and 400s a bad slot', async () => {
    h.email = 'owner@example.test';
    expect(await (await route.POST(ev({ date: '2026-10-28', stage: 'evening' }))).json()).toMatchObject({ ask: { stage: 'evening' } });
    expect(await status(route.POST(ev({ date: 'Wednesday', stage: 'evening' })))).toBe(400);
  });
});
