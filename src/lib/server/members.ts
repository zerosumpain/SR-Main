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
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityPrincipals, allowedUser, gmailAccounts } from '$lib/db/schema';

export type AllowedRole = 'guest' | 'member';

export function isAllowedRole(value: unknown): value is AllowedRole {
  return value === 'guest' || value === 'member';
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
 * Set a guest's role. Promotion creates their principal; demotion disables
 * their Gmail. Returns false when the email is not on the allow-list.
 */
export async function setMemberRole(email: string, role: AllowedRole): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const [guest] = await db.select().from(allowedUser).where(eq(allowedUser.email, e)).limit(1);
  if (!guest) return false;
  if (role === 'member') await ensureMemberPrincipal(e, guest.note?.trim() || e);
  await db.update(allowedUser).set({ role }).where(eq(allowedUser.email, e));
  if (role === 'guest') await disableMemberGmail(e);
  return true;
}
