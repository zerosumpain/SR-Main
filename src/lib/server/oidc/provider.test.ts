import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  authenticateClient,
  checkAuthorizeRequest,
  issueAccessToken,
  issueCode,
  issueIdToken,
  loadOidcConfig,
  openCode,
  pkceChallenge,
  spendCode,
  subjectFor,
  verifyAccessToken,
  verifyPkce,
  withParams,
  CODE_TTL_S,
  type OidcConfig,
} from './provider';

const SIGNING = 's'.repeat(40);
const SECRET = 'c'.repeat(40);
const ENV = {
  SR_OIDC_SIGNING_SECRET: SIGNING,
  SR_OIDC_IMMICH_CLIENT_ID: 'immich',
  SR_OIDC_IMMICH_CLIENT_SECRET: SECRET,
  SR_OIDC_IMMICH_REDIRECT_URIS: 'https://photos.example/auth/login, https://photos.example/user-settings,app.immich:///oauth-callback',
};
const config = loadOidcConfig(ENV) as OidcConfig;
const VERIFIER = 'v'.repeat(43) + 'Abc-._~';
const CHALLENGE = pkceChallenge(VERIFIER);

describe('loadOidcConfig', () => {
  it('is off unless every piece is present and long enough', () => {
    expect(loadOidcConfig({})).toBeNull();
    expect(loadOidcConfig({ ...ENV, SR_OIDC_SIGNING_SECRET: 'short' })).toBeNull();
    expect(loadOidcConfig({ ...ENV, SR_OIDC_IMMICH_CLIENT_SECRET: 'short' })).toBeNull();
    expect(loadOidcConfig({ ...ENV, SR_OIDC_IMMICH_REDIRECT_URIS: '' })).toBeNull();
    expect(loadOidcConfig({ ...ENV, SR_OIDC_IMMICH_CLIENT_ID: 'bad id!' })).toBeNull();
    expect(loadOidcConfig({ ...ENV, SR_OIDC_IMMICH_CLIENT_SECRET: SIGNING })).toBeNull();
  });

  it('keeps exact redirect URIs, dropping fragments and non-URLs', () => {
    const c = loadOidcConfig({ ...ENV, SR_OIDC_IMMICH_REDIRECT_URIS: 'https://a.example/cb#x, nope, https://a.example/cb' });
    expect(c?.clients[0].redirectUris).toEqual(['https://a.example/cb']);
    expect(config.clients[0].redirectUris).toHaveLength(3);
  });
});

describe('authorization code', () => {
  const input = { clientId: 'immich', redirectUri: 'https://photos.example/auth/login', email: 'owner@example.com', name: 'Owner', codeChallenge: CHALLENGE };

  it('round-trips sealed, and is opaque', () => {
    const code = issueCode(config, input);
    expect(code).not.toContain('owner');
    expect(openCode(config, code)).toMatchObject(input);
  });

  it('expires after its life', () => {
    const now = 1_800_000_000;
    const code = issueCode(config, input, now);
    expect(openCode(config, code, now + CODE_TTL_S - 1)).not.toBeNull();
    expect(openCode(config, code, now + CODE_TTL_S)).toBeNull();
  });

  it('refuses a tampered code or one sealed under another secret', () => {
    const code = issueCode(config, input);
    const flipped = code.slice(0, -2) + (code.at(-2) === 'A' ? 'B' : 'A') + code.at(-1);
    expect(openCode(config, flipped)).toBeNull();
    const other = loadOidcConfig({ ...ENV, SR_OIDC_SIGNING_SECRET: 't'.repeat(40) }) as OidcConfig;
    expect(openCode(other, code)).toBeNull();
    expect(openCode(config, 'garbage')).toBeNull();
  });

  it('is spent once', () => {
    const payload = openCode(config, issueCode(config, input))!;
    expect(spendCode(payload.jti, payload.exp)).toBe(true);
    expect(spendCode(payload.jti, payload.exp)).toBe(false);
  });
});

describe('PKCE', () => {
  it('accepts the matching S256 verifier only', () => {
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true);
    expect(verifyPkce('w'.repeat(43), CHALLENGE)).toBe(false);
    expect(verifyPkce('short', pkceChallenge('short'))).toBe(false);
    expect(verifyPkce(null, CHALLENGE)).toBe(false);
  });

  it('matches RFC 7636 appendix B', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('client authentication', () => {
  const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

  it('accepts client_secret_post and client_secret_basic', () => {
    expect(authenticateClient(config, null, new URLSearchParams({ client_id: 'immich', client_secret: SECRET })).ok).toBe(true);
    expect(authenticateClient(config, basic('immich', SECRET), new URLSearchParams()).ok).toBe(true);
  });

  it('refuses a wrong secret, an unknown client and two methods at once', () => {
    expect(authenticateClient(config, null, new URLSearchParams({ client_id: 'immich', client_secret: SECRET + 'x' }))).toMatchObject({ ok: false, error: 'invalid_client' });
    expect(authenticateClient(config, null, new URLSearchParams({ client_id: 'other', client_secret: SECRET }))).toMatchObject({ ok: false, error: 'invalid_client' });
    expect(authenticateClient(config, basic('immich', 'nope'), new URLSearchParams())).toMatchObject({ ok: false, error: 'invalid_client', basic: true });
    expect(authenticateClient(config, null, new URLSearchParams({ client_id: 'immich' }))).toMatchObject({ ok: false });
    expect(authenticateClient(config, basic('immich', SECRET), new URLSearchParams({ client_secret: SECRET }))).toMatchObject({ ok: false, error: 'invalid_request' });
  });
});

describe('checkAuthorizeRequest', () => {
  const good = {
    client_id: 'immich',
    redirect_uri: 'https://photos.example/auth/login',
    response_type: 'code',
    scope: 'openid email profile',
    state: 'st',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  };
  const check = (over: Record<string, string | null>) => {
    const p = new URLSearchParams(good);
    for (const [k, v] of Object.entries(over)) v === null ? p.delete(k) : p.set(k, v);
    return checkAuthorizeRequest(config, p);
  };

  it('accepts a complete request and carries the nonce', () => {
    expect(check({ nonce: 'n1' })).toMatchObject({ kind: 'ok', state: 'st', nonce: 'n1', codeChallenge: CHALLENGE });
  });

  it('never redirects for an unknown client or an unregistered redirect_uri', () => {
    expect(check({ client_id: 'evil' }).kind).toBe('fatal');
    expect(check({ redirect_uri: 'https://photos.example/auth/login/' }).kind).toBe('fatal');
    expect(check({ redirect_uri: 'https://evil.example/auth/login' }).kind).toBe('fatal');
    expect(check({ redirect_uri: null }).kind).toBe('fatal');
  });

  it('redirects other mistakes back with an error', () => {
    expect(check({ response_type: 'token' })).toMatchObject({ kind: 'redirect-error', error: 'unsupported_response_type' });
    expect(check({ scope: 'email' })).toMatchObject({ kind: 'redirect-error', error: 'invalid_scope' });
    expect(check({ state: null })).toMatchObject({ kind: 'redirect-error', error: 'invalid_request' });
    expect(check({ code_challenge: null })).toMatchObject({ kind: 'redirect-error', error: 'invalid_request' });
    expect(check({ code_challenge_method: 'plain' })).toMatchObject({ kind: 'redirect-error', error: 'invalid_request' });
  });

  it('appends to a custom-scheme redirect URI', () => {
    expect(withParams('app.immich:///oauth-callback', { code: 'c', state: 's' })).toBe('app.immich:///oauth-callback?code=c&state=s');
  });
});

describe('tokens', () => {
  it('signs and verifies access tokens, refusing expiry and tampering', () => {
    const now = Math.floor(Date.now() / 1000);
    const t = issueAccessToken(config, { sub: 'x', email: 'o@example.com', name: 'O', aud: 'immich', iat: now, exp: now + 300 });
    expect(verifyAccessToken(config, t)?.email).toBe('o@example.com');
    expect(verifyAccessToken(config, t, now + 300)).toBeNull();
    expect(verifyAccessToken(config, t.replace('at1.', 'at1.e'))).toBeNull();
    const other = loadOidcConfig({ ...ENV, SR_OIDC_SIGNING_SECRET: 't'.repeat(40) }) as OidcConfig;
    expect(verifyAccessToken(other, t)).toBeNull();
  });

  it('issues an HS256 ID token keyed with the client secret, nonce only when asked', () => {
    const client = config.clients[0];
    const jwt = issueIdToken(client, { iss: 'https://site.example', sub: 'abc', email: 'o@example.com', name: 'O' }, 1000);
    const [h, p, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(sig).toBe(createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url'));
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(claims).toMatchObject({ iss: 'https://site.example', aud: 'immich', sub: 'abc', email_verified: true, iat: 1000, exp: 1300 });
    expect(claims).not.toHaveProperty('nonce');
    const withNonce = issueIdToken(client, { iss: 'i', sub: 's', email: 'e', name: 'n', nonce: 'N' });
    expect(JSON.parse(Buffer.from(withNonce.split('.')[1], 'base64url').toString()).nonce).toBe('N');
  });

  it('gives one stable, secret-independent subject per email', () => {
    expect(subjectFor('Owner@Example.com ')).toBe(subjectFor('owner@example.com'));
    expect(subjectFor('owner@example.com')).toBe(createHash('sha256').update('sr-main/oidc-sub\0owner@example.com').digest('hex').slice(0, 40));
    expect(subjectFor('a@example.com')).not.toBe(subjectFor('b@example.com'));
  });
});
