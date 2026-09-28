import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('./notify', () => ({ notifyOwner: vi.fn() }));
vi.mock('./access', () => ({ isEmailAllowedToSignIn: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const { verifyAppleIdentityToken, resetAppleKeyCache } = await import('./registration');

// A stand-in for Apple: our own RSA key, published as a JWKS, signing tokens.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const NOW = Date.parse('2026-09-28T07:00:00Z');
const AUD = 'com.strangeramblings.com.appleapp';

function token(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'test-kid' }): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = `${enc(header)}.${enc(claims)}`;
  return `${head}.${sign('RSA-SHA256', Buffer.from(head), privateKey).toString('base64url')}`;
}

const NONCE = 'raw-nonce-from-the-app';
const good = {
  nonce: createHash('sha256').update(NONCE).digest('hex'),
  iss: 'https://appleid.apple.com',
  aud: AUD,
  exp: NOW / 1000 + 600,
  sub: '001234.abc',
  email: 'Sam@PrivateRelay.AppleID.com',
  email_verified: 'true',
  is_private_email: 'true',
};

const fetchKeys = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] })));
const verify = (t: string, opts: { now?: number; nonce?: string } = {}) =>
  verifyAppleIdentityToken(t, { fetchImpl: fetchKeys as unknown as typeof fetch, now: opts.now ?? NOW, audience: AUD, nonce: opts.nonce ?? NONCE });

beforeEach(() => {
  resetAppleKeyCache();
  fetchKeys.mockClear();
});

describe('Sign in with Apple identity tokens', () => {
  it('accepts a token Apple signed for this app, and reads the email', async () => {
    expect(await verify(token(good))).toEqual({ sub: '001234.abc', email: 'sam@privaterelay.appleid.com', privateEmail: true });
  });

  it('refuses a token for another app, another issuer, or past its expiry', async () => {
    expect(await verify(token({ ...good, aud: 'com.someone.else' }))).toBeNull();
    expect(await verify(token({ ...good, iss: 'https://evil.example' }))).toBeNull();
    expect(await verify(token({ ...good, exp: NOW / 1000 - 1 }))).toBeNull();
  });

  it('refuses an email Apple does not vouch for, or none', async () => {
    expect(await verify(token({ ...good, email_verified: 'false' }))).toBeNull();
    expect(await verify(token({ ...good, email: undefined }))).toBeNull();
  });

  it('refuses a tampered token and one signed by a key Apple never published', async () => {
    const t = token(good);
    const [h, , s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...good, email: 'owner@example.test' })).toString('base64url');
    expect(await verify(`${h}.${forged}.${s}`)).toBeNull();
    expect(await verify(token(good, { alg: 'RS256', kid: 'unknown' }))).toBeNull();
    expect(await verify(token(good, { alg: 'none', kid: 'test-kid' }))).toBeNull();
    expect(await verify('not.a-token')).toBeNull();
  });

  it('refetches Apple’s keys for an unknown key id, but at most once a minute', async () => {
    await verify(token(good));
    await verify(token({ ...good, sub: 'x' }, { alg: 'RS256', kid: 'rotated' }));
    expect(fetchKeys).toHaveBeenCalledTimes(1);
    await verify(token({ ...good, sub: 'y' }, { alg: 'RS256', kid: 'rotated' }), { now: NOW + 61_000 });
    expect(fetchKeys).toHaveBeenCalledTimes(2);
  });

  it('needs the nonce the app asked Apple to sign', async () => {
    expect(await verify(token(good), { nonce: 'another' })).toBeNull();
    expect(await verify(token(good), { nonce: '' })).toBeNull();
    expect(await verify(token({ ...good, nonce: undefined }))).toBeNull();
  });

  it('signs a token in once', async () => {
    const t = token({ ...good, sub: 'once' });
    expect(await verify(t)).not.toBeNull();
    expect(await verify(t)).toBeNull();
  });
});
