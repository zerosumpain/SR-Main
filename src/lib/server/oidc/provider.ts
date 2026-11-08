import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * A minimal, owner-only OpenID Connect provider: the site's own sign-in
 * (an Auth.js session) handed to a self-hosted app that only speaks OIDC —
 * Immich first. Routes: `/.well-known/openid-configuration`, `/oauth/authorize`,
 * `/oauth/token`, `/oauth/userinfo`, `/oauth/jwks`.
 *
 * STATELESS on purpose. No table (a new Main table 500s in production until it
 * is hand-granted, and drizzle push has traps of its own): an authorization
 * code is an AES-256-GCM sealed payload that lives for 60 seconds, an access
 * token is an HMAC'd payload that lives for 5 minutes, and the ID token is an
 * HS256 JWT keyed with the client's own secret, as OIDC Core 10.1 specifies for
 * a symmetric algorithm (and as Immich assumes). Code reuse is refused per
 * process by an in-memory set; with one Main process that is single-use, and the
 * 60-second life plus the PKCE verifier bound the rest.
 *
 * Configuration (all from the environment; any piece missing or too short and
 * every route answers 404 — the feature is off, never a 500):
 *   SR_OIDC_SIGNING_SECRET          ≥ 32 chars; seals codes, signs access tokens
 *   SR_OIDC_IMMICH_CLIENT_ID        e.g. `immich`
 *   SR_OIDC_IMMICH_CLIENT_SECRET    ≥ 32 chars; the same value goes into Immich
 *   SR_OIDC_IMMICH_REDIRECT_URIS    comma list, matched EXACTLY
 *
 * Only an owner (`isOwnerEmail`) is ever given a code; the route checks that.
 */

export interface OidcClient {
  id: string;
  secret: string;
  redirectUris: string[];
  name: string;
}

export interface OidcConfig {
  signingSecret: string;
  clients: OidcClient[];
}

export const CODE_TTL_S = 60;
export const ACCESS_TOKEN_TTL_S = 300;
export const ID_TOKEN_TTL_S = 300;
export const SCOPES = ['openid', 'email', 'profile'] as const;

const MIN_SECRET_LEN = 32;
const CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_PARAM_LEN = 512;

type Env = Record<string, string | undefined>;

/** Clients known to the provider. One today; the shape allows more. */
const CLIENT_ENV = [{ prefix: 'SR_OIDC_IMMICH', name: 'Immich' }] as const;

function parseRedirectUris(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const uri = part.trim();
    if (!uri) continue;
    try {
      const u = new URL(uri);
      if (u.hash) continue; // RFC 6749 3.1.2: no fragment
      out.push(uri);
    } catch {
      /* not a URL: never matched */
    }
  }
  return out;
}

/** The provider's configuration, or null when the feature is off. */
export function loadOidcConfig(env: Env): OidcConfig | null {
  const signingSecret = env.SR_OIDC_SIGNING_SECRET?.trim() ?? '';
  if (signingSecret.length < MIN_SECRET_LEN) return null;
  const clients: OidcClient[] = [];
  for (const { prefix, name } of CLIENT_ENV) {
    const id = env[`${prefix}_CLIENT_ID`]?.trim() ?? '';
    const secret = env[`${prefix}_CLIENT_SECRET`]?.trim() ?? '';
    const redirectUris = parseRedirectUris(env[`${prefix}_REDIRECT_URIS`]);
    if (!CLIENT_ID_RE.test(id) || secret.length < MIN_SECRET_LEN || redirectUris.length === 0) continue;
    if (secret === signingSecret) continue; // two jobs, two keys
    clients.push({ id, secret, redirectUris, name });
  }
  return clients.length ? { signingSecret, clients } : null;
}

export function findClient(config: OidcConfig, clientId: string | null | undefined): OidcClient | null {
  return config.clients.find((c) => c.id === clientId) ?? null;
}

// ---------------------------------------------------------------- primitives

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const fromB64url = (s: string) => Buffer.from(s, 'base64url');

function derive(secret: string, label: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'sr-main/oidc', label, 32));
}

/** Constant-time string equality (digests first, so lengths never leak or throw). */
export function safeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db) && a.length === b.length;
}

/**
 * The owner's stable subject. A plain hash of the lower-cased email, NOT keyed
 * with a secret: Immich links its account to `sub` on first sign-in and then
 * refuses the email match for a different `sub` ("email already linked"), so a
 * rotated secret must never change it.
 */
export function subjectFor(email: string): string {
  return createHash('sha256').update(`sr-main/oidc-sub\0${email.trim().toLowerCase()}`).digest('hex').slice(0, 40);
}

export function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export function isValidChallenge(challenge: string | null | undefined): challenge is string {
  return typeof challenge === 'string' && PKCE_CHALLENGE_RE.test(challenge);
}

export function verifyPkce(verifier: string | null | undefined, challenge: string): boolean {
  if (typeof verifier !== 'string' || !PKCE_VERIFIER_RE.test(verifier)) return false;
  return safeEqual(pkceChallenge(verifier), challenge);
}

// ---------------------------------------------------------- authorization code

export interface CodePayload {
  clientId: string;
  redirectUri: string;
  email: string;
  name: string;
  nonce?: string;
  codeChallenge: string;
  exp: number; // epoch seconds
  jti: string;
}

const CODE_PREFIX = 'c1.';

export function issueCode(
  config: OidcConfig,
  input: Omit<CodePayload, 'exp' | 'jti'>,
  nowS = Math.floor(Date.now() / 1000),
): string {
  const payload: CodePayload = { ...input, exp: nowS + CODE_TTL_S, jti: b64url(randomBytes(12)) };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive(config.signingSecret, 'code'), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return CODE_PREFIX + b64url(Buffer.concat([iv, cipher.getAuthTag(), ct]));
}

/** The code's payload if it is genuine and unexpired, else null. Does NOT mark it used. */
export function openCode(config: OidcConfig, code: string, nowS = Math.floor(Date.now() / 1000)): CodePayload | null {
  if (typeof code !== 'string' || !code.startsWith(CODE_PREFIX) || code.length > 4096) return null;
  try {
    const raw = fromB64url(code.slice(CODE_PREFIX.length));
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', derive(config.signingSecret, 'code'), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as CodePayload;
    if (typeof payload.exp !== 'number' || payload.exp <= nowS) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Codes already exchanged in this process, until they would have expired anyway. */
const spentCodes = new Map<string, number>();

/** True the first time a code id is spent, false on any replay. */
export function spendCode(jti: string, exp: number, nowS = Math.floor(Date.now() / 1000)): boolean {
  for (const [id, until] of spentCodes) if (until <= nowS) spentCodes.delete(id);
  if (spentCodes.has(jti)) return false;
  spentCodes.set(jti, exp);
  return true;
}

// ---------------------------------------------------------------- access token

export interface AccessClaims {
  sub: string;
  email: string;
  name: string;
  aud: string;
  iat: number;
  exp: number;
}

const ACCESS_PREFIX = 'at1.';

export function issueAccessToken(config: OidcConfig, claims: AccessClaims): string {
  const body = ACCESS_PREFIX + b64url(JSON.stringify(claims));
  const mac = createHmac('sha256', derive(config.signingSecret, 'access')).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

export function verifyAccessToken(
  config: OidcConfig,
  token: string | null | undefined,
  nowS = Math.floor(Date.now() / 1000),
): AccessClaims | null {
  if (typeof token !== 'string' || !token.startsWith(ACCESS_PREFIX) || token.length > 4096) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= ACCESS_PREFIX.length) return null;
  const body = token.slice(0, dot);
  const expected = b64url(createHmac('sha256', derive(config.signingSecret, 'access')).update(body).digest());
  if (!safeEqual(expected, token.slice(dot + 1))) return null;
  try {
    const claims = JSON.parse(fromB64url(body.slice(ACCESS_PREFIX.length)).toString('utf8')) as AccessClaims;
    if (typeof claims.exp !== 'number' || claims.exp <= nowS) return null;
    if (!findClient(config, claims.aud)) return null; // a client removed from env loses its tokens
    return claims;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------- id token

export function issueIdToken(
  client: OidcClient,
  claims: { iss: string; sub: string; email: string; name: string; nonce?: string },
  nowS = Math.floor(Date.now() / 1000),
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: Record<string, unknown> = {
    iss: claims.iss,
    sub: claims.sub,
    aud: client.id,
    iat: nowS,
    exp: nowS + ID_TOKEN_TTL_S,
    email: claims.email,
    email_verified: true,
    name: claims.name,
  };
  // Only when the client sent one: openid-client refuses a nonce it did not ask for.
  if (claims.nonce) payload.nonce = claims.nonce;
  const body = `${header}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${b64url(createHmac('sha256', client.secret).update(body).digest())}`;
}

// --------------------------------------------------------------- client auth

export type ClientAuth =
  | { ok: true; client: OidcClient }
  | { ok: false; error: 'invalid_client' | 'invalid_request'; basic: boolean };

/**
 * client_secret_basic (Authorization header) or client_secret_post (form body),
 * never both. Secrets compared in constant time.
 */
export function authenticateClient(config: OidcConfig, authorization: string | null, form: URLSearchParams): ClientAuth {
  let id: string | null = null;
  let secret: string | null = null;
  const basic = !!authorization && /^basic /i.test(authorization);
  if (basic) {
    if (form.has('client_secret')) return { ok: false, error: 'invalid_request', basic };
    try {
      const decoded = Buffer.from(authorization!.slice(6).trim(), 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      if (colon < 0) return { ok: false, error: 'invalid_client', basic };
      // RFC 6749 2.3.1: both halves are form-urlencoded before base64.
      id = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' '));
      secret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' '));
    } catch {
      return { ok: false, error: 'invalid_client', basic };
    }
    const bodyId = form.get('client_id');
    if (bodyId && bodyId !== id) return { ok: false, error: 'invalid_request', basic };
  } else {
    id = form.get('client_id');
    secret = form.get('client_secret');
  }
  const client = findClient(config, id);
  // Compare against something even for an unknown id, so timing says nothing.
  const matches = safeEqual(client?.secret ?? config.signingSecret, secret ?? '');
  if (!client || !secret || !matches) return { ok: false, error: 'invalid_client', basic };
  return { ok: true, client };
}

// ------------------------------------------------------------------ authorize

export type AuthorizeCheck =
  /** Do NOT redirect: the client or its redirect_uri cannot be trusted. */
  | { kind: 'fatal'; message: string }
  /** Redirect the error to the (validated) redirect_uri. */
  | { kind: 'redirect-error'; client: OidcClient; redirectUri: string; state: string | null; error: string; description: string }
  | {
      kind: 'ok';
      client: OidcClient;
      redirectUri: string;
      state: string;
      nonce?: string;
      codeChallenge: string;
    };

export function checkAuthorizeRequest(config: OidcConfig, params: URLSearchParams): AuthorizeCheck {
  const client = findClient(config, params.get('client_id'));
  if (!client) return { kind: 'fatal', message: 'Unknown client.' };
  const redirectUri = params.get('redirect_uri') ?? '';
  if (!client.redirectUris.includes(redirectUri)) return { kind: 'fatal', message: 'That redirect address is not registered for this client.' };
  const state = params.get('state');
  const fail = (error: string, description: string): AuthorizeCheck => ({
    kind: 'redirect-error',
    client,
    redirectUri,
    state: state && state.length <= MAX_PARAM_LEN ? state : null,
    error,
    description,
  });
  if (params.get('response_type') !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
  const scopes = (params.get('scope') ?? '').split(/\s+/).filter(Boolean);
  if (!scopes.includes('openid')) return fail('invalid_scope', 'The openid scope is required.');
  if (!state || state.length > MAX_PARAM_LEN) return fail('invalid_request', 'state is required.');
  const codeChallenge = params.get('code_challenge');
  if (params.get('code_challenge_method') !== 'S256' || !isValidChallenge(codeChallenge)) {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }
  const nonce = params.get('nonce') ?? undefined;
  if (nonce !== undefined && (nonce.length === 0 || nonce.length > MAX_PARAM_LEN)) return fail('invalid_request', 'nonce is malformed.');
  return { kind: 'ok', client, redirectUri, state, nonce, codeChallenge };
}

/** redirect_uri with the given parameters added (keeps any query it already had). */
export function withParams(redirectUri: string, add: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(add)) if (v != null) url.searchParams.set(k, v);
  return url.href;
}

// ---------------------------------------------------------------- discovery

export function discoveryDocument(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    jwks_uri: `${issuer}/oauth/jwks`,
    scopes_supported: [...SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['HS256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    code_challenge_methods_supported: ['S256'],
    claims_supported: ['iss', 'sub', 'aud', 'iat', 'exp', 'nonce', 'email', 'email_verified', 'name'],
    authorization_response_iss_parameter_supported: true,
  };
}
