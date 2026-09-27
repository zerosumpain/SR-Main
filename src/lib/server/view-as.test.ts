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
  principals: new Map<string, string>(),
  threads: [] as string[],
  deleteWhere: null as unknown,
}));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.test' } }));
vi.mock('$lib/db/schema', () => ({
  allowedUser: { email: 'allowed_user.email' },
  activityPrincipals: { id: 'p.id', kind: 'p.kind', externalRef: 'p.external_ref' },
  conversations: { id: 'c.id', principalId: 'c.principal_id', source: 'c.source' },
}));
vi.mock('drizzle-orm', () => ({
  eq: (col: string, v: string) => ((h.lastEmail = col.endsWith('email') || col.endsWith('external_ref') ? v : h.lastEmail), [col, v]),
  and: (...parts: unknown[]) => parts,
}));
vi.mock('$lib/db', () => {
  let table = '';
  const chain = {
    select: () => chain,
    from: (t: Record<string, string>) => ((table = Object.values(t)[0]), chain),
    where: () => chain,
    limit: async () => {
      if (table.startsWith('p.')) return h.principals.has(h.lastEmail) ? [{ id: h.principals.get(h.lastEmail) }] : [];
      return h.allowed.has(h.lastEmail) ? [{ email: h.lastEmail }] : [];
    },
    delete: () => ({
      where: (cond: unknown) => ({
        returning: async () => ((h.deleteWhere = cond), h.threads.map((id) => ({ id }))),
      }),
    }),
  };
  return { db: chain };
});
vi.mock('./access', () => ({ isOwnerEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase() === OWNER }));
vi.mock('./grants', () => ({ loadMember: async (e: string) => h.members.get(e) ?? null }));

const { actAs, purgeViewAsThreads, signViewAs, verifyViewAs, viewerForEmail, VIEW_AS_TTL_S } = await import('./view-as');
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
    expect(await isOwnerRequest({ locals })).toBe(false);
    expect(locals.viewingAs).toEqual({ email: ANN, kind: 'member', expiresAt: NOW });
  });

  it('a guest is a guest', async () => {
    const locals = ownerLocals();
    actAs(locals, { kind: 'guest', email: BOB }, NOW);
    expect(await viewerOf({ locals })).toEqual({ kind: 'guest', email: BOB });
    expect(await isOwnerRequest({ locals })).toBe(false);
  });
});

describe('leaving view-as', () => {
  it('deletes only that person\u2019s view-as threads', async () => {
    h.principals = new Map([[ANN, 'u_ann']]);
    h.threads = ['t1', 't2'];
    expect(await purgeViewAsThreads(ANN)).toBe(2);
    expect(h.deleteWhere).toEqual([
      ['c.principal_id', 'u_ann'],
      ['c.source', 'view-as'],
    ]);
  });

  it('deletes nothing for someone with no principal', async () => {
    h.deleteWhere = null;
    expect(await purgeViewAsThreads('nobody@example.test')).toBe(0);
    expect(h.deleteWhere).toBeNull();
  });
});
