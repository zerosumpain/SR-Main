import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pkceChallenge } from '$lib/server/oidc/provider';

const h = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: new Proxy({}, { get: (_t, k: string) => h.env[k] }) }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e?.toLowerCase() === 'owner@example.com' }));

const authorize = await import('./authorize/+server');
const token = await import('./token/+server');
const userinfo = await import('./userinfo/+server');
const jwks = await import('./jwks/+server');
const discovery = await import('../[x+2e]well-known/openid-configuration/+server');

const SECRET = 'c'.repeat(40);
const ON = {
  SR_OIDC_SIGNING_SECRET: 's'.repeat(40),
  SR_OIDC_IMMICH_CLIENT_ID: 'immich',
  SR_OIDC_IMMICH_CLIENT_SECRET: SECRET,
  SR_OIDC_IMMICH_REDIRECT_URIS: 'https://photos.example/auth/login',
};
const ORIGIN = 'https://site.example';
const REDIRECT = 'https://photos.example/auth/login';
const VERIFIER = 'x'.repeat(50);

function authorizeUrl(over: Record<string, string> = {}) {
  const u = new URL('/oauth/authorize', ORIGIN);
  const p = { client_id: 'immich', redirect_uri: REDIRECT, response_type: 'code', scope: 'openid email profile', state: 'st8', code_challenge: pkceChallenge(VERIFIER), code_challenge_method: 'S256', ...over };
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  return u;
}

async function call(handler: (e: never) => unknown, event: Record<string, unknown>): Promise<Response> {
  try {
    return (await handler(event as never)) as Response;
  } catch (thrown) {
    const r = thrown as { status?: number; location?: string };
    if (r?.location) return new Response(null, { status: r.status, headers: { location: r.location } });
    throw thrown;
  }
}

const session = (email: string | null) => ({ auth: async () => (email ? { user: { email, name: 'The Owner' } } : null) });

async function getCode(email = 'owner@example.com', over: Record<string, string> = {}) {
  const res = await call(authorize.GET, { url: authorizeUrl(over), locals: session(email) });
  return res;
}

function tokenRequest(form: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form).toString(),
  });
}

async function exchange(code: string, over: Record<string, string> = {}) {
  const form = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: 'immich', client_secret: SECRET, ...over };
  return call(token.POST, { request: tokenRequest(form), url: new URL('/oauth/token', ORIGIN) });
}

beforeEach(() => {
  h.env = { ...ON };
});

describe('feature off', () => {
  it('every route 404s while unconfigured', async () => {
    h.env = {};
    expect((await call(discovery.GET, { url: new URL(ORIGIN) })).status).toBe(404);
    expect((await call(jwks.GET, {})).status).toBe(404);
    expect((await getCode()).status).toBe(404);
    expect((await exchange('c1.x')).status).toBe(404);
    expect((await call(userinfo.GET, { request: new Request(`${ORIGIN}/oauth/userinfo`) })).status).toBe(404);
  });
});

describe('discovery and keys', () => {
  it('names the endpoints under the site origin', async () => {
    const doc = await (await call(discovery.GET, { url: new URL('/.well-known/openid-configuration', ORIGIN) })).json();
    expect(doc).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/oauth/authorize`,
      token_endpoint: `${ORIGIN}/oauth/token`,
      code_challenge_methods_supported: ['S256'],
      id_token_signing_alg_values_supported: ['HS256'],
    });
    expect(await (await call(jwks.GET, {})).json()).toEqual({ keys: [] });
  });
});

describe('/oauth/authorize', () => {
  it('sends a visitor with no session to the login, back to this exact URL', async () => {
    const res = await getCode(null as never);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!, ORIGIN);
    expect(loc.pathname).toBe('/login');
    expect(loc.searchParams.get('callbackUrl')).toBe(authorizeUrl().pathname + authorizeUrl().search);
  });

  it('refuses a signed-in non-owner with a plain 403', async () => {
    const res = await getCode('member@example.com');
    expect(res.status).toBe(403);
    expect(res.headers.get('location')).toBeNull();
  });

  it('does not redirect to an unregistered redirect_uri', async () => {
    const res = await getCode('owner@example.com', { redirect_uri: 'https://evil.example/auth/login' });
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('bounces a missing PKCE challenge back to the client as an error', async () => {
    const res = await getCode('owner@example.com', { code_challenge_method: 'plain' });
    const loc = new URL(res.headers.get('location')!);
    expect(loc.searchParams.get('error')).toBe('invalid_request');
    expect(loc.searchParams.get('state')).toBe('st8');
  });

  it('gives the owner a code with state and iss', async () => {
    const res = await getCode();
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get('code')).toMatch(/^c1\./);
    expect(loc.searchParams.get('state')).toBe('st8');
    expect(loc.searchParams.get('iss')).toBe(ORIGIN);
  });
});

describe('/oauth/token and /oauth/userinfo', () => {
  const codeFrom = async (over: Record<string, string> = {}) => new URL((await getCode('owner@example.com', over)).headers.get('location')!).searchParams.get('code')!;

  it('exchanges a code once for an ID token and an access token the userinfo accepts', async () => {
    const code = await codeFrom({ nonce: 'n-1' });
    const res = await exchange(code);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 300 });
    const claims = JSON.parse(Buffer.from(body.id_token.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({ iss: ORIGIN, aud: 'immich', email: 'owner@example.com', email_verified: true, name: 'The Owner', nonce: 'n-1' });

    const info = await call(userinfo.GET, { request: new Request(`${ORIGIN}/oauth/userinfo`, { headers: { authorization: `Bearer ${body.access_token}` } }) });
    expect(info.status).toBe(200);
    expect(await info.json()).toEqual({ sub: claims.sub, email: 'owner@example.com', email_verified: true, name: 'The Owner' });

    const replay = await exchange(code);
    expect(replay.status).toBe(400);
    expect((await replay.json()).error).toBe('invalid_grant');
  });

  it('accepts client_secret_basic', async () => {
    const code = await codeFrom();
    const basic = `Basic ${Buffer.from(`immich:${SECRET}`).toString('base64')}`;
    const form = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER };
    const res = await call(token.POST, { request: tokenRequest(form, { authorization: basic }), url: new URL('/oauth/token', ORIGIN) });
    expect(res.status).toBe(200);
  });

  it('refuses a wrong client secret with 401 invalid_client', async () => {
    const res = await exchange(await codeFrom(), { client_secret: 'wrong'.repeat(10) });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('invalid_client');
  });

  it('refuses a redirect_uri mismatch, a wrong verifier and an expired code', async () => {
    expect((await exchange(await codeFrom(), { redirect_uri: 'https://photos.example/user-settings' })).status).toBe(400);
    expect((await exchange(await codeFrom(), { code_verifier: 'y'.repeat(50) })).status).toBe(400);
    vi.useFakeTimers();
    try {
      const code = await codeFrom();
      vi.setSystemTime(Date.now() + 61_000);
      const res = await exchange(code);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_grant');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a non-form body and a bad bearer', async () => {
    const res = await call(token.POST, { request: new Request(`${ORIGIN}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }), url: new URL(ORIGIN) });
    expect(res.status).toBe(400);
    const info = await call(userinfo.GET, { request: new Request(`${ORIGIN}/oauth/userinfo`, { headers: { authorization: 'Bearer at1.nope.nope' } }) });
    expect(info.status).toBe(401);
    expect(info.headers.get('www-authenticate')).toContain('invalid_token');
  });
});
