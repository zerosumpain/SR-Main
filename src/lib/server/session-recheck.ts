// Re-checking an EXISTING session against the guest allow-list (the Auth.js
// `jwt` callback in hooks.server.ts). Its own module rather than a function in
// ./access because ./access is duplicated byte for byte in SR-Health
// (shared-with-extracted.json) and this is a Main-only concern.

import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { isOwnerEmail } from './access';

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
