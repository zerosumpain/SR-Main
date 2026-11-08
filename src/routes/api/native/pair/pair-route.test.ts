import { beforeEach, describe, expect, it, vi } from 'vitest';

// /api/native/pair with a SCANNED code — the QR /welcome shows for whoever is
// signed in there. The phone redeeming it must be signed in as that person.
// 2026-10-19: the owner's browser was signed in when his son scanned the codes,
// and the son's phone became the owner's.

const OWNER = 'john@example.test';
const SON = 'fintan@example.test';
const SECRET = 'route-test-secret'.padEnd(40, 'x');

const h = vi.hoisted(() => ({
  code: null as null | { kind: 'pair' | 'scan'; ownerEmail: string },
  held: null as null | { id: string; ownerEmail: string; label: string | null; expiresAt: Date },
  redeemed: [] as string[],
  revoked: [] as string[],
  issued: [] as string[],
  notes: [] as string[],
}));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'john@example.test', AUTH_SECRET: 'route-test-secret'.padEnd(40, 'x') } }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => h.held,
  peekPairingCode: async () => h.code,
  redeemPairingCode: async (code: string) => {
    h.redeemed.push(code);
    return h.code ? { token: 't'.repeat(43), ownerEmail: h.code.ownerEmail, expiresAt: new Date(Date.now() + 1000) } : null;
  },
  revokeDevice: async (_email: string, id: string) => {
    h.revoked.push(id);
    return true;
  },
  issueDevice: async (email: string) => {
    h.issued.push(email);
    return { token: 'j'.repeat(43), ownerEmail: email, expiresAt: new Date(Date.now() + 1000) };
  },
}));
vi.mock('$lib/server/app-devices', () => ({ joinCandidates: async () => ['john@example.test', 'fintan@example.test'] }));
vi.mock('$lib/server/notify', () => ({
  notifyOwner: async (n: { title: string }) => {
    h.notes.push(n.title);
    return { raised: true };
  },
}));
vi.mock('$lib/server/grants', () => ({
  loadMember: async (e: string) => (e === SON ? { principalId: 'p_son', grants: new Set(['family:circle']) } : null),
}));
vi.mock('$lib/access/catalogue', () => ({ satisfies: (g: Set<string>, p: string) => g.has(p) }));
vi.mock('$lib/server/registration', () => ({ canonicalEmail: async (e: string) => e.trim().toLowerCase(), isRegistrant: async () => false }));
vi.mock('$lib/home/presence/members', () => ({
  memberByEmail: async (e: string) => ({ displayName: e === OWNER ? 'John Kelly' : 'Fintan Kelly' }),
}));

const { POST } = await import('./+server');
const { mintPairIdentity, pairCodeHash } = await import('$lib/server/pair-identity');
const { mintJoinCode } = await import('$lib/server/adhoc-install');

const CODE = 'C'.repeat(43);

function call(body: Record<string, unknown>, bearer = false) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer) headers.authorization = `Bearer ${'d'.repeat(43)}`;
  const request = new Request('https://site.test/api/native/pair', { method: 'POST', headers, body: JSON.stringify(body) });
  return POST({ request, getClientAddress: () => `198.51.100.${Math.floor(Math.random() * 250)}` } as never);
}

beforeEach(() => {
  h.code = null;
  h.held = null;
  h.redeemed = [];
  h.revoked = [];
  h.issued = [];
  h.notes = [];
});

describe('a scanned code', () => {
  it('refuses a phone signed in as someone else, and stays live for its person', async () => {
    h.code = { kind: 'scan', ownerEmail: OWNER };
    h.held = { id: 'son-phone', ownerEmail: SON, label: 'iPhone', expiresAt: new Date(Date.now() + 1000) };
    const res = await call({ code: CODE }, true);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.wrongPerson).toBe(true);
    expect(body.error).toContain('John’s');
    expect(body.error).toContain('signed in as Fintan');
    expect(h.redeemed).toEqual([]);
  });

  it('refuses a fresh sign-in as someone else just the same', async () => {
    h.code = { kind: 'scan', ownerEmail: OWNER };
    const identity = mintPairIdentity(SON, pairCodeHash(CODE), SECRET);
    const res = await call({ code: CODE, identity });
    expect(res.status).toBe(409);
    expect(h.redeemed).toEqual([]);
  });

  it('asks a phone signed in as nobody to sign in first', async () => {
    h.code = { kind: 'scan', ownerEmail: OWNER };
    const res = await call({ code: CODE });
    expect(res.status).toBe(428);
    expect((await res.json()).signIn).toBe(true);
    expect(h.redeemed).toEqual([]);
  });

  it("will not take another code's sign-in", async () => {
    h.code = { kind: 'scan', ownerEmail: OWNER };
    const identity = mintPairIdentity(OWNER, pairCodeHash('Z'.repeat(43)), SECRET);
    expect((await call({ code: CODE, identity })).status).toBe(428);
  });

  it('connects the person it was made for, by a fresh sign-in', async () => {
    h.code = { kind: 'scan', ownerEmail: OWNER };
    const identity = mintPairIdentity(OWNER, pairCodeHash(CODE), SECRET);
    const res = await call({ code: CODE, identity });
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBeTruthy();
    expect(h.redeemed).toEqual([CODE]);
  });

  it("connects by the phone's own credential, and retires that one", async () => {
    h.code = { kind: 'scan', ownerEmail: SON };
    h.held = { id: 'son-phone', ownerEmail: SON, label: 'iPhone', expiresAt: new Date(Date.now() + 1000) };
    const res = await call({ code: CODE }, true);
    expect(res.status).toBe(200);
    expect(h.revoked).toEqual(['son-phone']);
  });
});

describe('a code handed straight to its phone', () => {
  it('needs no sign-in — the sign-in that minted it was the check', async () => {
    h.code = { kind: 'pair', ownerEmail: SON };
    const res = await call({ code: CODE });
    expect(res.status).toBe(200);
    expect(h.redeemed).toEqual([CODE]);
  });

  it('still answers an unknown code with the one sentence', async () => {
    const res = await call({ code: CODE }, true);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('That pairing code is not valid.');
  });
});

describe('an install link, opened in the installed app', () => {
  it('pairs the phone as its person once signed in as them, and tells the owner', async () => {
    const join = mintJoinCode('Fintan', SECRET, SON, 'identity');
    expect((await call({ join })).status).toBe(428);
    const identity = mintPairIdentity(SON, pairCodeHash(join), SECRET);
    const res = await call({ join, identity });
    expect(res.status).toBe(200);
    expect((await res.json()).token).toBeTruthy();
    expect(h.issued).toEqual([SON]);
    expect(h.redeemed).toEqual([]);
    expect(h.notes).toEqual(['Fintan’s phone connected from the install link']);
  });

  it('refuses a phone signed in as someone else', async () => {
    const join = mintJoinCode('Fintan', SECRET, SON, 'identity');
    const identity = mintPairIdentity(OWNER, pairCodeHash(join), SECRET);
    expect((await call({ join, identity })).status).toBe(409);
    expect(h.issued).toEqual([]);
  });

  it('pairs on the owner’s word alone when the link was made that way — for a child who cannot sign in', async () => {
    const join = mintJoinCode('Fintan', SECRET, SON, 'vouch');
    const res = await call({ join });
    expect(res.status).toBe(200);
    expect(h.issued).toEqual([SON]);
    expect(h.notes).toEqual(['Fintan’s phone connected from the install link']);
    // Any of their phones, for its week: the link is not spent.
    expect((await call({ join })).status).toBe(200);
  });

  it('is nobody’s once expired, forged, or made for someone the site does not know', async () => {
    expect((await call({ join: mintJoinCode('Fintan', SECRET, SON, 'vouch', Date.now() - 8 * 86_400_000) })).status).toBe(401);
    expect((await call({ join: 'fintan-0123456789' })).status).toBe(401);
    expect((await call({ join: mintJoinCode('Fintan', SECRET, 'stranger@example.test', 'vouch') })).status).toBe(401);
    expect(h.issued).toEqual([]);
  });

  it('refuses a person who may not hold a device, even vouched', async () => {
    expect((await call({ join: mintJoinCode('Who', SECRET, 'john@example.test', 'vouch') })).status).toBe(200); // the owner
    const res = await call({ join: mintJoinCode('Fintan', SECRET, 'fintan@example.test', 'vouch') });
    expect(res.status).toBe(200);
  });
});
