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

import { createHash, createPublicKey, randomBytes, verify as verifySignature, type webcrypto } from 'node:crypto';
import { and, desc, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { accessRequest, accessSecurityAudit, allowedUser, nativeCredentials } from '$lib/db/schema';
import { isEmailAllowedToSignIn, isOwnerEmail } from './access';
import { addToAllowList } from './allow-list';
import { joinGroups } from './invites';
import { notifyOwner } from './notify';
import { memberByEmail } from '$lib/home/presence/members';

/**
 * A random nonce set by /welcome/app before Google. The Auth.js callbacks
 * stamp it into the session made by that sign-in, and /welcome/app/finish
 * accepts only a session carrying the same nonce — never one the browser
 * already had.
 */
export const REGISTER_COOKIE = 'sr_register';
export const REGISTER_COOKIE_MAX_AGE_S = 10 * 60;
export const REGISTER_FINISH_PATH = '/welcome/app/finish';

/**
 * Set beside the nonce when the app opens /welcome/app?confirm=<code hash> to
 * learn who is signed in on the phone for a code it has scanned. Finish then
 * mints a pairing identity (`$lib/server/pair-identity`) instead of
 * registering anyone.
 */
export const PAIR_CONFIRM_COOKIE = 'sr_pair_confirm';

export function mintRegisterNonce(): string {
  return randomBytes(24).toString('base64url');
}

export function isRegisterNonce(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);
}

/** Asking again inside this window after a no shows the no, rather than a fresh request. */
export const DECLINED_HOLD_MS = 30 * 24 * 60 * 60 * 1000;

export type RegistrantStatus = 'pending' | 'declined' | 'approved';

export interface Registration {
  status: RegistrantStatus;
  name: string;
  email: string;
  decidedAt: Date | null;
}

/**
 * The address a sign-in from the app stands for. Someone whose Google address
 * was linked on their person page is known by it now; their Apple relay
 * address is kept as an alias (`allowed_user.aliases`) and resolves here, so
 * a new phone signed in with Apple finds them rather than filing a request.
 */
export async function canonicalEmail(email: string): Promise<string> {
  const e = email.trim().toLowerCase();
  const [row] = await db
    .select({ email: allowedUser.email })
    .from(allowedUser)
    .where(sql`${allowedUser.aliases} ? ${e}`)
    .limit(1);
  return row?.email ?? e;
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

/** The group a pre-registered family member joins on their first sign-in. */
export const PRE_REGISTERED_GROUP = 'family-circle';

/**
 * Record an app sign-in as a request, once. Someone already allowed needs
 * none; someone refused in the last 30 days sees the refusal; someone the
 * owner has already added to the household by this address is PRE-REGISTERED
 * and let straight in (`admitPreRegistered`); someone already waiting is not
 * asked again (nor is the owner notified twice).
 */
export async function ensureAppRequest(input: {
  email: string;
  name: string | null;
  via: 'google' | 'apple';
}): Promise<EnsureOutcome> {
  const email = input.email.trim().toLowerCase();
  if (await isEmailAllowedToSignIn(email)) return 'allowed';
  const latest = await registrationOf(email);
  if (latest?.status === 'declined' && latest.decidedAt && Date.now() - latest.decidedAt.getTime() < DECLINED_HOLD_MS) {
    return 'declined';
  }
  if (await admitPreRegistered(email, input.via)) return 'allowed';
  if (latest?.status === 'pending') return 'pending';
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

/**
 * The owner's say-so, given in advance: a household person (/home/people) whose
 * email is this sign-in's — Apple or Google vouched for the address, and only
 * the owner puts an address on a household row (removing someone unlinks it).
 * They join the allow-list in Family Circle exactly as an approval would, any
 * request they left waiting is marked approved, and the owner is told. Nobody
 * else: an address the household does not know still asks and waits.
 */
export async function admitPreRegistered(email: string, via: 'google' | 'apple'): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!e || isOwnerEmail(e)) return false;
  const member = await memberByEmail(e).catch(() => null);
  if (!member) return false;
  const name = member.displayName?.trim() || nameFromEmail(e);

  const phones = await registrantPhones(e);
  const since = await databaseNow();
  await addToAllowList({ email: e, note: name, addedBy: null });
  await joinGroups(e, [PRE_REGISTERED_GROUP]);
  await carryRegistrantPhones(e, phones, since);

  const decided = { status: 'approved', decidedAt: new Date(), decidedBy: null };
  const waiting = await db
    .update(accessRequest)
    .set(decided)
    .where(and(eq(accessRequest.email, e), eq(accessRequest.status, 'pending')))
    .returning({ id: accessRequest.id });
  if (waiting.length === 0) {
    await db.insert(accessRequest).values({ email: e, name, message: null, wants: { app: true, via, preRegistered: true }, ipHash: null, ...decided });
  }
  await notifyOwner({
    category: 'access',
    title: `${name} joined from the app`,
    body: `${e} · signed in with ${via === 'apple' ? 'Apple' : 'Google'} · pre-registered in the household, so let straight in to ${PRE_REGISTERED_GROUP}`,
    url: '/admin/access',
    severity: 'info',
    dedupeKey: `access-preregistered:${e}`,
  }).catch((err) => console.error('[registration] notify failed:', err));
  return true;
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

export type RegistrantPhone = Pick<
  typeof nativeCredentials.$inferSelect,
  'id' | 'apnsToken' | 'apnsTokenAt' | 'laStartToken' | 'laStartTokenAt'
>;

/**
 * The live phone credentials of someone NOT on the allow-list — so,
 * registrant credentials — read just before approval adds them to it. None
 * for the owner or anyone already on the list: their phones were minted with
 * the access they have, and a change to it revokes them as designed.
 */
export async function registrantPhones(email: string): Promise<RegistrantPhone[]> {
  const e = email.trim().toLowerCase();
  if (isOwnerEmail(e)) return [];
  const [listed] = await db.select({ email: allowedUser.email }).from(allowedUser).where(eq(allowedUser.email, e)).limit(1);
  if (listed) return [];
  return db
    .select({
      id: nativeCredentials.id,
      apnsToken: nativeCredentials.apnsToken,
      apnsTokenAt: nativeCredentials.apnsTokenAt,
      laStartToken: nativeCredentials.laStartToken,
      laStartTokenAt: nativeCredentials.laStartTokenAt,
    })
    .from(nativeCredentials)
    .where(
      and(
        eq(nativeCredentials.ownerEmail, e),
        eq(nativeCredentials.kind, 'device'),
        isNull(nativeCredentials.revokedAt),
        gt(nativeCredentials.expiresAt, new Date()),
      ),
    );
}

/** The database's clock, which is the one the trigger stamps `revoked_at` with. */
export async function databaseNow(): Promise<Date> {
  const r = await db.execute<{ now: Date | string }>(sql`SELECT now() AS now`);
  return new Date(r.rows[0].now);
}

/**
 * Approval's promise: "nothing on the phone changes". Put back exactly the
 * phones `registrantPhones` saw, and only where the revocation is the one this
 * approval caused (at or after `since`) — a phone revoked before it, or by
 * anything else, stays revoked. Recorded in the security audit beside the
 * trigger's own line. Every one of these re-derives its access per request
 * (`withNativeAccess`), so carrying it over grants nothing the allow-list
 * row does not.
 */
export async function carryRegistrantPhones(email: string, phones: readonly RegistrantPhone[], since: Date): Promise<number> {
  let carried = 0;
  for (const p of phones) {
    const rows = await db
      .update(nativeCredentials)
      .set({ revokedAt: null, apnsToken: p.apnsToken, apnsTokenAt: p.apnsTokenAt, laStartToken: p.laStartToken, laStartTokenAt: p.laStartTokenAt })
      .where(and(eq(nativeCredentials.id, p.id), gte(nativeCredentials.revokedAt, since)))
      .returning({ id: nativeCredentials.id });
    carried += rows.length;
  }
  if (carried) {
    await db.insert(accessSecurityAudit).values({ email: email.trim().toLowerCase(), reason: 'registrant-phone-carried' });
  }
  return carried;
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
  // A forced refetch (an unknown key id) at most once a minute: otherwise a
  // stream of made-up kids would have this server fetching Apple on each one.
  if (keyCache && (force ? now - keyCache.at < 60_000 : now - keyCache.at < 60 * 60_000)) return keyCache.keys;
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
/** Tokens already spent, by hash, until they expire: each signs in once. */
const spent = new Map<string, number>();

export async function verifyAppleIdentityToken(
  token: string,
  opts: { fetchImpl?: typeof fetch; now?: number; audience?: string; nonce?: string } = {},
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
  // The app asked Apple for sha256(nonce) and sends the nonce itself: a token
  // lifted from somewhere else arrives without the secret that goes with it.
  const nonce = opts.nonce ?? '';
  if (!nonce || typeof claims.nonce !== 'string' || createHash('sha256').update(nonce).digest('hex') !== claims.nonce) {
    return null;
  }
  const key = createHash('sha256').update(token).digest('hex');
  for (const [k, exp] of spent) if (exp < now) spent.delete(k);
  if (spent.has(key)) return null;
  spent.set(key, claims.exp * 1000);
  const privateEmail = claims.is_private_email === true || claims.is_private_email === 'true';
  return { sub: claims.sub, email, privateEmail };
}

/** For tests: forget the cached keys. */
export function resetAppleKeyCache(): void {
  keyCache = null;
  spent.clear();
}
