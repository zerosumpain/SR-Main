// Members' principals — what a signed-in non-owner's material hangs off.
//
// A member is an `allowed_user` row holding at least one permission (see
// $lib/server/grants) plus an `activity_principals` row of kind 'user' whose
// `external_ref` is the same lower-cased email. The principal's id (`u_…`) is
// their SPACE: every intel row they own carries it, and `resolveRequestScope`
// turns it into `[u_…, 'household']` for anything they read.
//
// BOTH halves are required. The permissions are what the owner sets at
// /admin/access; the principal is what the data hangs off, and it outlives a
// demotion so granting someone access again finds their graph where they left
// it. A member is only recognised while they hold something — revoking is
// immediate, because it is read on every request rather than cached.

import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityPrincipals, gmailAccounts, householdMember } from '$lib/db/schema';

/** `u_` + ten base-36 characters: short enough to read in a log, too many to guess. */
export function newMemberPrincipalId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(10);
  let out = 'u_';
  for (const b of bytes) out += alphabet[b % 36];
  return out;
}

/**
 * Who an email is on the household trail — their `household_member` subject —
 * or null. This is identity, not permission: whether they may LOOK at
 * /home/people is `family:circle` (see `peopleViewerOf`). A row without the
 * permission is someone tracked, not someone who may look; the permission
 * without a row has nobody to be.
 *
 * The join is written here rather than through `$lib/home/presence/members`
 * because $lib/server sits below $lib/home in the module layers.
 */
export async function householdSubjectFor(email: string | null | undefined): Promise<string | null> {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return null;
  const [row] = await db
    .select({ subject: householdMember.subject })
    .from(householdMember)
    // lower(): the column is meant to hold lower-cased email, but a row written
    // by hand (or before normalising on write) must not quietly lock its person
    // out — or match on case alone.
    .where(sql`lower(${householdMember.email}) = ${e}`)
    .limit(1);
  return row?.subject ?? null;
}

/**
 * The principal for an email, created on first promotion.
 *
 * Idempotent on `external_ref`: promoting, demoting and promoting again lands
 * on the same `u_…` id, so the member's graph is theirs again. There is no
 * unique index behind this (the table is populated; see
 * reference_drizzle_unique_push_gotcha) — the owner clicks a toggle, so the
 * only race is the owner racing themselves.
 */
export async function ensureMemberPrincipal(email: string, label: string): Promise<string> {
  const [existing] = await db
    .select({ id: activityPrincipals.id })
    .from(activityPrincipals)
    .where(and(eq(activityPrincipals.kind, 'user'), eq(activityPrincipals.externalRef, email)))
    .limit(1);
  if (existing) return existing.id;
  const id = newMemberPrincipalId();
  await db.insert(activityPrincipals).values({ id, kind: 'user', externalRef: email, label });
  return id;
}

/**
 * Stop reading a former member's mailboxes. Their graph stays where it is —
 * demoting is not deleting — but a nightly sweep of a mailbox whose owner can
 * no longer sign in to see it would be reading someone's mail for nobody.
 */
export async function disableMemberGmail(email: string): Promise<number> {
  const e = email.trim().toLowerCase();
  const [principal] = await db
    .select({ id: activityPrincipals.id })
    .from(activityPrincipals)
    .where(and(eq(activityPrincipals.kind, 'user'), eq(activityPrincipals.externalRef, e)))
    .limit(1);
  if (!principal) return 0;
  const rows = await db
    .update(gmailAccounts)
    .set({ status: 'disabled', lastError: 'Access revoked at /admin/access', updatedAt: new Date() })
    .where(eq(gmailAccounts.principalId, principal.id))
    .returning({ id: gmailAccounts.id });
  return rows.length;
}
