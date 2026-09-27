import { describe, expect, it, vi } from 'vitest';

// View as: the owner sees the site as one person on the allow-list. What must
// hold is who the REST of the request believes it is talking to — so these
// assert on `viewerOf` and `isOwnerRequest` themselves, the answers every gate
// and seam reads — and that nobody but the owner can make a cookie count.

const OWNER = 'owner@example.test';
const ANN = 'ann@example.test';
const BOB = 'bob@example.test';
const SECRET = 'test-secret';

const h = vi.hoisted(() => ({
  allowed: new Set<string>(),
  members: new Map<string, { principalId: string; grants: Set<string> }>(),
  lastEmail: '',
}));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.test' } }));
vi.mock('$lib/db/schema', () => ({ allowedUser: { email: 'email' } }));
vi.mock('drizzle-orm', () => ({ eq: (_col: unknown, v: string) => ((h.lastEmail = v), v) }));
vi.mock('$lib/db', () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => (h.allowed.has(h.lastEmail) ? [{ email: h.lastEmail }] : []),
  };
  return { db: chain };
});
vi.mock('./access', () => ({ isOwnerEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase() === OWNER }));
vi.mock('./grants', () => ({ loadMember: async (e: string) => h.members.get(e) ?? null }));

const { actAs, signViewAs, verifyViewAs, viewerForEmail, VIEW_AS_TTL_S } = await import('./view-as');
const { viewerOf } = await import('./viewer');
const { isOwnerRequest } = await import('./owner');

const NOW = Date.parse('2026-09-27T12:00:00Z');

describe('the view-as cookie', () => {
  it('names the target for the owner who signed it', () => {
    const c = signViewAs(SECRET, OWNER, ANN, NOW);
    expect(verifyViewAs(SECRET, OWNER, c, NOW + 1000)).toEqual({ email: ANN, expiresAt: NOW + VIEW_AS_TTL_S * 1000 });
  });

  it('is worthless to anyone else, tampered, expired or unsigned', () => {
    const c = signViewAs(SECRET, OWNER, ANN, NOW);
    expect(verifyViewAs(SECRET, ANN, c, NOW)).toBeNull();
    expect(verifyViewAs('other-secret', OWNER, c, NOW)).toBeNull();
    const [, exp, sig] = c.split('.');
    expect(verifyViewAs(SECRET, OWNER, `${Buffer.from(BOB).toString('base64url')}.${exp}.${sig}`, NOW)).toBeNull();
    expect(verifyViewAs(SECRET, OWNER, c, NOW + VIEW_AS_TTL_S * 1000)).toBeNull();
    expect(verifyViewAs('', OWNER, c, NOW)).toBeNull();
    expect(verifyViewAs(SECRET, OWNER, 'garbage', NOW)).toBeNull();
    expect(() => signViewAs('', OWNER, ANN, NOW)).toThrow();
  });
});

describe('who can be viewed as', () => {
  it('a member, a guest — never the owner or someone not on the list', async () => {
    h.allowed = new Set([ANN, BOB]);
    h.members = new Map([[ANN, { principalId: 'u_ann', grants: new Set(['news:self']) }]]);
    expect(await viewerForEmail(ANN)).toMatchObject({ kind: 'member', principalId: 'u_ann', email: ANN });
    expect(await viewerForEmail(BOB)).toEqual({ kind: 'guest', email: BOB });
    expect(await viewerForEmail(OWNER)).toBeNull();
    expect(await viewerForEmail('stranger@example.test')).toBeNull();
  });
});

describe('acting as', () => {
  function ownerLocals(): App.Locals {
    return { auth: async () => ({ user: { email: OWNER }, expires: '' }) } as App.Locals;
  }

  it('the rest of the request sees the person, not the owner', async () => {
    const locals = ownerLocals();
    // A viewer the owner's session had already resolved must not survive.
    locals.viewer = Promise.resolve({ kind: 'owner' });
    actAs(locals, { kind: 'member', principalId: 'u_ann', email: ANN, grants: new Set(['news:self']) }, NOW);
    expect(await viewerOf({ locals })).toMatchObject({ kind: 'member', email: ANN });
    expect((await locals.auth())?.user?.email).toBe(ANN);
    expect(await isOwnerRequest({ locals, getClientAddress: () => '127.0.0.1' })).toBe(false);
    expect(locals.viewingAs).toEqual({ email: ANN, kind: 'member', expiresAt: NOW });
  });

  it('a guest is a guest', async () => {
    const locals = ownerLocals();
    actAs(locals, { kind: 'guest', email: BOB }, NOW);
    expect(await viewerOf({ locals })).toEqual({ kind: 'guest', email: BOB });
    expect(await isOwnerRequest({ locals })).toBe(false);
  });
});
