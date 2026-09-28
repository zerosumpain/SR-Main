// Registering from the iPhone app: a person nobody knows signs in with Google
// or Apple, leaves a request with the owner, and gets a phone credential that
// reaches exactly one thing — `/api/native/me`, which says whether the request
// is still pending. Approval (at /admin/access, like any request) turns the
// same credential into an ordinary member's; nothing on the phone changes.
//
// A registrant is not a member: they hold no grants, `loadMember` answers null,
// and every `withNativeAccess` route refuses them. `/api/native/me` is the one
// route that asks this file instead.
//
// Spec: docs/superpowers/specs/2026-09-28-people-and-app-registration.md (P2)

import { createPublicKey, verify as verifySignature, type webcrypto } from 'node:crypto';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { accessRequest, nativeCredentials } from '$lib/db/schema';
import { isEmailAllowedToSignIn } from './access';
import { notifyOwner } from './notify';

/** Set by /welcome/app before Google, read back by the Auth.js signIn callback. */
export const REGISTER_COOKIE = 'sr_register';
export const REGISTER_COOKIE_MAX_AGE_S = 10 * 60;

/** Asking again inside this window after a no shows the no, rather than a fresh request. */
export const DECLINED_HOLD_MS = 30 * 24 * 60 * 60 * 1000;

export type RegistrantStatus = 'pending' | 'declined' | 'approved';

export interface Registration {
  status: RegistrantStatus;
  name: string;
  email: string;
  decidedAt: Date | null;
}

/** The latest request this email made, if any. */
export async function registrationOf(email: string): Promise<Registration | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const [row] = await db
    .select()
    .from(accessRequest)
    .where(eq(accessRequest.email, e))
    .orderBy(desc(accessRequest.createdAt))
    .limit(1);
  if (!row) return null;
  const status = row.status === 'approved' || row.status === 'declined' ? row.status : 'pending';
  return { status, name: row.name, email: row.email, decidedAt: row.decidedAt };
}

/**
 * May a phone credential be issued to this email as a REGISTRANT — someone
 * whose request is pending, or was declined (the phone must be able to say so)?
 */
export async function isRegistrant(email: string): Promise<boolean> {
  const r = await registrationOf(email);
  return r?.status === 'pending' || r?.status === 'declined';
}

export type EnsureOutcome = 'allowed' | 'pending' | 'declined';

/**
 * Record an app sign-in as a request, once. Someone already allowed needs
 * none; someone already waiting is not asked again (nor is the owner
 * notified twice); someone refused in the last 30 days sees the refusal.
 */
export async function ensureAppRequest(input: {
  email: string;
  name: string | null;
  via: 'google' | 'apple';
}): Promise<EnsureOutcome> {
  const email = input.email.trim().toLowerCase();
  if (await isEmailAllowedToSignIn(email)) return 'allowed';
  const latest = await registrationOf(email);
  if (latest?.status === 'pending') return 'pending';
  if (latest?.status === 'declined' && latest.decidedAt && Date.now() - latest.decidedAt.getTime() < DECLINED_HOLD_MS) {
    return 'declined';
  }
  const name = input.name?.trim().replace(/\s+/g, ' ').slice(0, 80) || nameFromEmail(email);
  await db.insert(accessRequest).values({
    email,
    name,
    message: null,
    wants: { app: true, via: input.via },
    ipHash: null,
  });
  await notifyOwner({
    category: 'access',
    title: `${name} asked for access from the app`,
    body: `${email} · signed in with ${input.via === 'apple' ? 'Apple' : 'Google'}`,
    url: '/admin/access#requests',
    severity: 'info',
    dedupeKey: `access-request:${email}`,
  }).catch((err) => console.error('[registration] notify failed:', err));
  return 'pending';
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/**
 * The phone takes its request back: every request this email has not had
 * approved is deleted, and every phone credential it holds is revoked.
 */
export async function withdrawRegistration(email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await db.delete(accessRequest).where(and(eq(accessRequest.email, e), inArray(accessRequest.status, ['pending', 'declined'])));
  await db
    .update(nativeCredentials)
    .set({ revokedAt: new Date() })
    .where(and(eq(nativeCredentials.ownerEmail, e), isNull(nativeCredentials.revokedAt)));
}

// ── Sign in with Apple ──────────────────────────────────────────────────────

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const DEFAULT_BUNDLE_ID = 'com.strangeramblings.com.appleapp';

/** The app's bundle id: what Apple puts in `aud` for a native sign-in. */
export function appleAudience(): string {
  return env.APPLE_BUNDLE_ID || env.APNS_BUNDLE_ID || DEFAULT_BUNDLE_ID;
}

export interface AppleIdentity {
  sub: string;
  email: string;
  /** Apple's relay address: the person chose to hide their real one. */
  privateEmail: boolean;
}

type AppleKey = webcrypto.JsonWebKey & { kid?: string };

let keyCache: { at: number; keys: AppleKey[] } | null = null;

async function appleKeys(fetchImpl: typeof fetch, now: number, force = false): Promise<AppleKey[]> {
  if (!force && keyCache && now - keyCache.at < 60 * 60_000) return keyCache.keys;
  const res = await fetchImpl(APPLE_KEYS_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Apple keys: ${res.status}`);
  const body = (await res.json()) as { keys?: AppleKey[] };
  keyCache = { at: now, keys: Array.isArray(body.keys) ? body.keys : [] };
  return keyCache.keys;
}

function b64urlJson(part: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Check an identity token from Sign in with Apple, or null. RS256 against
 * Apple's published keys (refetched once if the key id is new — Apple
 * rotates), issuer, audience (this app), expiry, and an email Apple vouches
 * for. Node's own crypto: one algorithm, no library needed.
 */
export async function verifyAppleIdentityToken(
  token: string,
  opts: { fetchImpl?: typeof fetch; now?: number; audience?: string } = {},
): Promise<AppleIdentity | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now();
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  let keys = await appleKeys(fetchImpl, now);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await appleKeys(fetchImpl, now, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;

  let ok = false;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    ok = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  } catch {
    return null;
  }
  if (!ok) return null;

  if (claims.iss !== APPLE_ISSUER) return null;
  const aud = opts.audience ?? appleAudience();
  if (claims.aud !== aud) return null;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  // Apple sends these as booleans or as the strings "true"/"false".
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!email || !verified) return null;
  const privateEmail = claims.is_private_email === true || claims.is_private_email === 'true';
  return { sub: claims.sub, email, privateEmail };
}

/** For tests: forget the cached keys. */
export function resetAppleKeyCache(): void {
  keyCache = null;
}
