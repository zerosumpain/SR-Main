import { beforeEach, describe, expect, it, vi } from 'vitest';

// Where the app's Google sign-in lands. Registering, it refuses the owner and
// mints a code for anyone else; confirming who holds a scanned code, it vouches
// for whoever signed in — the owner too — and registers nobody.

const NONCE = 'n'.repeat(32);
const OWNER = 'john@example.test';
const SECRET = 'finish-test-secret'.padEnd(40, 'x');

const h = vi.hoisted(() => ({ requests: [] as string[], codes: [] as string[] }));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_SECRET: 'finish-test-secret'.padEnd(40, 'x') } }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === OWNER }));
vi.mock('$lib/server/native-auth', () => ({
  createPairingCode: async (e: string) => {
    h.codes.push(e);
    return { code: 'c'.repeat(43), expiresAt: new Date() };
  },
}));
vi.mock('$lib/server/registration', () => ({
  REGISTER_COOKIE: 'sr_register',
  PAIR_CONFIRM_COOKIE: 'sr_pair_confirm',
  isRegisterNonce: (v: unknown) => v === 'n'.repeat(32),
  canonicalEmail: async (e: string) => e,
  ensureAppRequest: async ({ email }: { email: string }) => {
    h.requests.push(email);
    return 'pending';
  },
}));

const { GET } = await import('./+server');
const { pairCodeHash, verifyPairIdentity } = await import('$lib/server/pair-identity');

const CODE = 'Q'.repeat(43);

async function land(email: string, confirm?: string): Promise<URL> {
  const jar = new Map<string, string>([['sr_register', NONCE]]);
  if (confirm) jar.set('sr_pair_confirm', confirm);
  const event = {
    locals: { auth: async () => ({ user: { email, name: 'Someone' }, registerNonce: NONCE }) },
    cookies: { get: (k: string) => jar.get(k), delete: (k: string) => jar.delete(k) },
  };
  try {
    await GET(event as never);
  } catch (r) {
    return new URL((r as { location: string }).location);
  }
  throw new Error('expected a redirect');
}

beforeEach(() => {
  h.requests = [];
  h.codes = [];
});

describe('/welcome/app/finish', () => {
  it('confirming a scanned code: vouches for who signed in, the owner too, and registers nobody', async () => {
    const back = await land(OWNER, pairCodeHash(CODE));
    const identity = back.searchParams.get('identity');
    expect(verifyPairIdentity(identity, CODE, SECRET)).toBe(OWNER);
    expect(back.searchParams.get('code')).toBeNull();
    expect(h.requests).toEqual([]);
    expect(h.codes).toEqual([]);
  });

  it('registering: still refuses the owner and mints a code for anyone else', async () => {
    expect((await land(OWNER)).searchParams.get('error')).toContain('website');
    const back = await land('fintan@example.test');
    expect(back.searchParams.get('code')).toBe('c'.repeat(43));
    expect(h.requests).toEqual(['fintan@example.test']);
  });
});
