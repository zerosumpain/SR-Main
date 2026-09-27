import { describe, expect, it, vi } from 'vitest';

// The bug class: a handler the hook lets through BEFORE its owner gate (an
// exact-path service bypass) then asks "is anyone signed in?" instead of "is
// this the owner?" — so a friend's guest session unlocked it. Found by the
// 2026-09-27 pre-invite audit on the codegraph query (every Claude memory note,
// verbatim), the Home Assistant backfill, and the research maintenance lane.
// Each case: owner allowed, guest refused.

const OWNER = 'owner@example.test';
const GUEST = 'friend@example.test';

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: OWNER } }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/home/presence/backfill', () => ({
  DEFAULT_BACKFILL_DAYS: 30,
  backfillFromHomeAssistant: async () => {
    throw new Error('reached the backfill');
  },
}));
vi.mock('$lib/home/presence/places', () => ({ refreshPlaces: async () => ({}) }));
vi.mock('$lib/codegraph/auth', () => ({
  codegraphServiceAuthorized: () => false,
  codegraphBuildAuthorized: () => null,
  codegraphAuthFailure: () => 'unauthorised',
}));
vi.mock('$lib/codegraph/query', () => ({
  CgqlError: class extends Error {},
  parseCgql: () => {
    throw new Error('reached the query');
  },
}));
vi.mock('$lib/codegraph/retrieve', () => ({ renderContext: () => '', runPlan: async () => ({}) }));

const locals = (email: string) => ({ auth: async () => ({ user: { email }, expires: '' }) }) as unknown as App.Locals;
const post = () => new Request('https://x.test/', { method: 'POST', body: '{}' });

describe('an owner-or-service endpoint refuses a guest session', () => {
  it('research maintenance', async () => {
    const { isMaintenanceAuthorized } = await import('./maintenance-auth');
    expect(await isMaintenanceAuthorized(post(), locals(OWNER))).toBe(true);
    expect(await isMaintenanceAuthorized(post(), locals(GUEST))).toBe(false);
  });

  it('the Home Assistant backfill', async () => {
    const { POST } = await import('../../routes/api/daydream/backfill/+server');
    const res = (await POST({ request: post(), locals: locals(GUEST) } as never)) as Response;
    expect(res.status).toBe(401);
    // The owner gets past the gate (the mocked backfill then fails, as a 500).
    const owner = (await POST({ request: post(), locals: locals(OWNER) } as never)) as Response;
    expect(owner.status).not.toBe(401);
  });

  it('the codegraph query (memory notes)', async () => {
    const { POST } = await import('../../routes/api/jkai/codegraph/query/+server');
    await expect(POST({ request: post(), locals: locals(GUEST) } as never)).rejects.toMatchObject({ status: 403 });
    await expect(POST({ request: post(), locals: locals(OWNER) } as never)).rejects.not.toMatchObject({ status: 403 });
  });
});
