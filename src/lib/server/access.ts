// Single source of truth for "who may sign in" and "who is an owner".
//
// Two distinct concepts, deliberately NOT the same list:
//  - OWNERS come from the AUTH_ALLOWED_EMAILS env var. They get /admin, the
//    owner-only API surfaces (forge, /api/auth/me) and push. This stays
//    env-based so the owner can never be locked out by a DB outage or an empty
//    table, and so existing owner checks keep identical semantics.
//  - GUESTS live in the `allowed_user` DB table (managed at /admin/access). They
//    may sign in with Google and use the authed site, but are NOT owners.
//
// A user may sign in if they are an owner OR a guest.

import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { parseEmailList, emailInList } from './access-util';

export { parseEmailList, emailInList } from './access-util';

/** The owner allow-list (AUTH_ALLOWED_EMAILS), lower-cased. */
export function getOwnerEmails(): string[] {
  return parseEmailList(env.AUTH_ALLOWED_EMAILS);
}

/** True when the email is a site owner (env-based, no DB). */
export function isOwnerEmail(email: string | undefined | null): boolean {
  return emailInList(email, getOwnerEmails());
}

/** Guest emails from the DB allow-list, lower-cased. */
export async function getGuestEmails(): Promise<string[]> {
  const rows = await db.select({ email: allowedUser.email }).from(allowedUser);
  return rows.map((r) => r.email.toLowerCase());
}

/**
 * Sign-in gate: owners (env) OR guests (DB) may sign in. Owners are checked
 * first WITHOUT touching the DB, so an owner can always sign in even if the DB
 * is unreachable; a DB error only denies guests (fail-closed for non-owners).
 */
export async function isEmailAllowedToSignIn(email: string | undefined | null): Promise<boolean> {
  const e = (email || '').trim().toLowerCase();
  if (!e) return false;
  const owners = getOwnerEmails();
  // Fail-closed: with no owners configured (env unset or mis-loaded) admit
  // nobody, matching the previous signIn behaviour. Otherwise a zero-owner site
  // would still admit guests while the real owner — unrecognised as an owner —
  // is locked out of /admin.
  if (owners.length === 0) {
    console.error('[access] AUTH_ALLOWED_EMAILS is empty — refusing all sign-ins (fail-closed).');
    return false;
  }
  if (emailInList(e, owners)) return true;
  try {
    const rows = await db
      .select({ email: allowedUser.email })
      .from(allowedUser)
      .where(eq(allowedUser.email, e));
    return rows.length > 0;
  } catch (err) {
    console.error('[access] guest allow-list lookup failed:', err);
    return false;
  }
}

/**
 * How long a guest's "still on the allow-list" answer is trusted before the
 * next request looks again. Sessions are JWTs that live for weeks, and until
 * this existed the list was consulted only at sign-in — so removing a guest at
 * /admin/access changed nothing for a browser that was already signed in.
 * Five minutes is the revocation delay; it keeps the check off the hot path.
 */
export const GUEST_RECHECK_MS = 5 * 60_000;
const guestVerdicts = new Map<string, { allowed: boolean; at: number }>();

/**
 * Whether an existing session's holder may keep it. Owners always may, with
 * no database read. A guest is looked up at most once per GUEST_RECHECK_MS.
 *
 * A lookup that FAILS keeps the session (and caches nothing): the session was
 * valid when issued, and a database blip must not sign every guest out.
 * Revocation needs a successful read that says "not on the list".
 */
export async function sessionStillAllowed(email: string | undefined | null, now = Date.now()): Promise<boolean> {
  const e = (email || '').trim().toLowerCase();
  if (!e) return false;
  if (isOwnerEmail(e)) return true;
  const cached = guestVerdicts.get(e);
  if (cached && now - cached.at < GUEST_RECHECK_MS) return cached.allowed;
  try {
    const rows = await db
      .select({ email: allowedUser.email })
      .from(allowedUser)
      .where(eq(allowedUser.email, e));
    const allowed = rows.length > 0;
    if (guestVerdicts.size > 1_000) guestVerdicts.clear();
    guestVerdicts.set(e, { allowed, at: now });
    return allowed;
  } catch (err) {
    console.error('[access] guest re-check failed; keeping the session:', err);
    return true;
  }
}

/** Test seam: forget cached guest verdicts. */
export function resetGuestVerdicts(): void {
  guestVerdicts.clear();
}
