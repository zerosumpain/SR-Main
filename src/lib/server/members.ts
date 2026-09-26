// Family members — the one role between a guest and the owner.
//
// A member is an `allowed_user` row with `role = 'member'` plus an
// `activity_principals` row of kind 'user' whose `external_ref` is the same
// lower-cased email. The principal's id (`u_…`) is their intel SPACE: every
// intel row they own carries it, and `resolveRequestScope` turns it into
// `[u_…, 'household']` for anything they read.
//
// BOTH halves are required. The role is what the owner toggles at
// /admin/access; the principal is what the data hangs off, and it outlives a
// demotion so promoting someone again finds their graph where they left it.
// A member is only recognised while the role says so — demoting is immediate,
// because this is read on every request rather than cached.

import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityPrincipals, allowedUser, gmailAccounts, householdMember } from '$lib/db/schema';

/**
 * 'household' is a family member who may see /home/people and their own page
 * under it (spec: household movement, section 4). It needs a
 * `household_member` row with the same email too — see `householdSubjectFor`.
 */
export type AllowedRole = 'guest' | 'member' | 'household';

export function isAllowedRole(value: unknown): value is AllowedRole {
  return value === 'guest' || value === 'member' || value === 'household';
}

/** `u_` + ten base-36 characters: short enough to read in a log, too many to guess. */
export function newMemberPrincipalId(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = randomBytes(10);
  let out = 'u_';
  for (const b of bytes) out += alphabet[b % 36];
  return out;
}

/** The member principal for an email, or null when it is not a member now. */
export async function memberPrincipalFor(email: string | null | undefined): Promise<string | null> {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return null;
  const [row] = await db
    .select({ id: activityPrincipals.id })
    .from(allowedUser)
    .innerJoin(
      activityPrincipals,
      and(eq(activityPrincipals.kind, 'user'), eq(activityPrincipals.externalRef, allowedUser.email)),
    )
    .where(and(eq(allowedUser.email, e), eq(allowedUser.role, 'member')))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The household subject for an email, or null when it is not a household
 * viewer now. BOTH halves are required, as for a member: the `allowed_user`
 * role 'household' (the owner's grant, and what lets them sign in) and a
 * `household_member` row carrying the same lower-cased email (who they are on
 * the trail). A row without the role is someone tracked, not someone who may
 * look; the role without a row has nobody to be.
 *
 * Read on every request that asks, not cached, so revoking is immediate. The
 * join is written here rather than through `$lib/home/presence/members`
 * because $lib/server sits below $lib/home in the module layers.
 */
export async function householdSubjectFor(email: string | null | undefined): Promise<string | null> {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return null;
  const [row] = await db
    .select({ subject: householdMember.subject })
    .from(allowedUser)
    // lower() on both sides: both columns are meant to hold lower-cased
    // email, but a row written by hand (or before normalising on write) must
    // not quietly lock its person out — or match on case alone.
    .innerJoin(householdMember, sql`lower(${householdMember.email}) = lower(${allowedUser.email})`)
    .where(and(sql`lower(${allowedUser.email}) = ${e}`, eq(allowedUser.role, 'household')))
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
async function ensureMemberPrincipal(email: string, label: string): Promise<string> {
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

/**
 * Set a guest's role. Promotion to member creates their principal; any other
 * role disables their Gmail. Returns false when the email is not on the allow-list.
 */
export async function setMemberRole(email: string, role: AllowedRole): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const [guest] = await db.select().from(allowedUser).where(eq(allowedUser.email, e)).limit(1);
  if (!guest) return false;
  if (role === 'member') await ensureMemberPrincipal(e, guest.note?.trim() || e);
  await db.update(allowedUser).set({ role }).where(eq(allowedUser.email, e));
  // Anything but member stops reading their mail: a household viewer has no
  // intel space, so a Gmail sweep for them would read mail for nobody.
  if (role !== 'member') await disableMemberGmail(e);
  return true;
}
