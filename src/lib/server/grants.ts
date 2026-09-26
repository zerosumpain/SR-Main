// What a signed-in non-owner may do: their groups' grants plus their own
// one-off grants, filtered through the catalogue.
//
// Permissions are defined in code ($lib/access/catalogue); this file only
// reads and writes WHO holds them — `allowed_user.groups/grants` and the
// `access_group` table, both edited at /admin/access. Anything stored that the
// catalogue does not define is dropped here, on every read, so a row can never
// grant more than the code allows.
//
// A user holding ANY permission has an `activity_principals` row (`u_…`): it is
// what their material hangs off, it is created on first grant, and it outlives
// every later demotion (see $lib/server/members).
//
// Spec: docs/superpowers/specs/2026-09-26-access-groups-design.md

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { accessGroup, activityPrincipals, allowedUser } from '$lib/db/schema';
import { BUILT_IN_GROUPS, levelOf, parsePermissions, type Permission } from '$lib/access/catalogue';
import { asList, effectivePermissions } from '$lib/access/effective';
import { disableMemberGmail, ensureMemberPrincipal } from './members';

export type AccessGroupRow = typeof accessGroup.$inferSelect;

// Pure, and moved to $lib/access/effective so SR-Drive can resolve a member's
// permissions from the same rows without this file's server imports.
export { asList, effectivePermissions };

/** Group ids a user may be put in: the stored list, known groups only, once each. */
function cleanGroupIds(ids: readonly unknown[], known: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const id of ids) if (typeof id === 'string' && known.has(id) && !out.includes(id)) out.push(id);
  return out;
}

/**
 * Seed the built-in groups. Idempotent and cheap (one insert that conflicts on
 * every row after the first run), and never overwrites the owner's edits: a
 * built-in's label and grants are theirs to change once it exists.
 */
export async function ensureBuiltInGroups(): Promise<void> {
  await db
    .insert(accessGroup)
    .values(
      BUILT_IN_GROUPS.map((g) => ({
        id: g.id,
        label: g.label,
        description: g.description,
        grants: [...g.grants],
        builtIn: true,
      })),
    )
    .onConflictDoNothing();
}

export async function listGroups(): Promise<AccessGroupRow[]> {
  await ensureBuiltInGroups();
  return db.select().from(accessGroup).orderBy(sql`${accessGroup.builtIn} desc, ${accessGroup.label}`);
}

async function groupGrants(stored: unknown): Promise<Map<string, unknown>> {
  const wanted = asList(stored).filter((id): id is string => typeof id === 'string');
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ id: accessGroup.id, grants: accessGroup.grants })
    .from(accessGroup)
    .where(inArray(accessGroup.id, wanted));
  return new Map(rows.map((r) => [r.id, r.grants]));
}

/**
 * A member — a signed-in non-owner holding at least one permission — or null
 * for a guest. Read on every request (through `viewerOf`, once per request),
 * never cached across requests, so revoking is immediate.
 *
 * Someone who holds something but has no principal yet — a pre-groups
 * `role='household'` row, which never needed one, or a row edited by hand —
 * gets one here, once. Refusing them instead would take access away on deploy.
 */
export async function loadMember(
  email: string | null | undefined,
): Promise<{ principalId: string; grants: Set<Permission> } | null> {
  const e = (email ?? '').trim().toLowerCase();
  if (!e) return null;
  const [row] = await db
    .select({
      role: allowedUser.role,
      groups: allowedUser.groups,
      grants: allowedUser.grants,
      principalId: activityPrincipals.id,
    })
    .from(allowedUser)
    .leftJoin(
      activityPrincipals,
      and(eq(activityPrincipals.kind, 'user'), eq(activityPrincipals.externalRef, allowedUser.email)),
    )
    .where(eq(allowedUser.email, e))
    .limit(1);
  if (!row) return null;
  const grants = effectivePermissions(row, await groupGrants(row.groups));
  if (grants.size === 0) return null;
  const principalId = row.principalId ?? (await ensureMemberPrincipal(e, e));
  return { principalId, grants };
}

/**
 * Set a user's groups and one-off grants. Unknown groups and permissions are
 * dropped. Holding anything creates their principal; holding no intel level
 * any more stops their Gmail being swept (their graph stays — demoting is not
 * deleting). Returns the stored access, or null when the email is not on the
 * allow-list.
 */
export async function setUserAccess(
  email: string,
  access: { groups: readonly unknown[]; grants: readonly unknown[] },
): Promise<{ groups: string[]; grants: Permission[]; effective: Permission[] } | null> {
  const e = email.trim().toLowerCase();
  const [user] = await db.select().from(allowedUser).where(eq(allowedUser.email, e)).limit(1);
  if (!user) return null;

  const all = await listGroups();
  const groups = cleanGroupIds(access.groups, new Set(all.map((g) => g.id)));
  const grants = parsePermissions(access.grants);
  const effective = effectivePermissions(
    { role: 'guest', groups, grants },
    new Map(all.map((g) => [g.id, g.grants])),
  );

  if (effective.size > 0) await ensureMemberPrincipal(e, user.note?.trim() || e);
  await db.update(allowedUser).set({ groups, grants, role: 'guest' }).where(eq(allowedUser.email, e));
  if (levelOf(effective, 'jkai.intel') === null) await disableMemberGmail(e);
  return { groups, grants, effective: [...effective] };
}

/**
 * Bring users in line with what they now hold, after a group edit or delete
 * changed it for people the owner never opened: anyone who holds something gets
 * a principal, and anyone who holds no intel level stops having their Gmail
 * swept — reading mail into a space nobody can see would be reading it for
 * nobody.
 */
async function reconcileUsers(emails: readonly string[]): Promise<void> {
  if (emails.length === 0) return;
  const all = await listGroups();
  const byId = new Map(all.map((g) => [g.id, g.grants]));
  const users = await db.select().from(allowedUser).where(inArray(allowedUser.email, [...emails]));
  for (const user of users) {
    const effective = effectivePermissions(user, byId);
    if (effective.size > 0) await ensureMemberPrincipal(user.email, user.note?.trim() || user.email);
    if (levelOf(effective, 'jkai.intel') === null) await disableMemberGmail(user.email);
  }
}

async function emailsInGroup(id: string): Promise<string[]> {
  const rows = await db
    .select({ email: allowedUser.email })
    .from(allowedUser)
    .where(sql`${allowedUser.groups} ? ${id}::text`);
  return rows.map((r) => r.email);
}

const GROUP_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** A group id from its label: `Research readers` → `research-readers`. */
export function groupIdFromLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Create a group (no `id`) or update one. Grants are filtered through the
 * catalogue; a built-in keeps its flag whatever the caller sends.
 */
export async function saveGroup(input: {
  id?: string;
  label: string;
  description?: string | null;
  grants: readonly unknown[];
}): Promise<AccessGroupRow | { error: string }> {
  const label = input.label.trim();
  if (!label) return { error: 'A group needs a name' };
  const grants = parsePermissions(input.grants);
  const description = input.description?.trim() || null;
  await ensureBuiltInGroups();

  if (input.id) {
    const [row] = await db
      .update(accessGroup)
      .set({ label, description, grants, updatedAt: new Date() })
      .where(eq(accessGroup.id, input.id))
      .returning();
    if (!row) return { error: 'No such group' };
    await reconcileUsers(await emailsInGroup(row.id));
    return row;
  }

  const id = groupIdFromLabel(label);
  if (!GROUP_ID_RE.test(id)) return { error: 'Use letters or numbers in the name' };
  const [row] = await db
    .insert(accessGroup)
    .values({ id, label, description, grants, builtIn: false })
    .onConflictDoNothing()
    .returning();
  return row ?? { error: 'A group with that name already exists' };
}

/** Delete a group and take it off every user. Built-ins cannot be deleted. */
export async function deleteGroup(id: string): Promise<'deleted' | 'built-in' | 'missing'> {
  const [row] = await db.select().from(accessGroup).where(eq(accessGroup.id, id)).limit(1);
  if (!row) return 'missing';
  if (row.builtIn) return 'built-in';
  const members = await emailsInGroup(id);
  await db.transaction(async (tx) => {
    await tx
      .update(allowedUser)
      .set({ groups: sql`${allowedUser.groups} - ${id}::text` })
      .where(sql`${allowedUser.groups} ? ${id}::text`);
    await tx.delete(accessGroup).where(eq(accessGroup.id, id));
  });
  await reconcileUsers(members);
  return 'deleted';
}
