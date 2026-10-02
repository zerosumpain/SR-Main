// What Main's session authority tells an extracted application about the
// person behind a request, beyond the email (see /api/internal/session).
//
// The edge gateway asks Main, then SIGNS the answer into the 30-second
// assertion it sends to the app (SR-Infra gateway/identity.mjs). So the app
// no longer reads Main's identity tables to decide who someone is or what they
// hold: Main decides, the gateway vouches, the app verifies.
//
// Each claim goes only to the audience that needs it, fixed here rather than
// read from the request, so one application's gateway key cannot ask for
// another application's claims.
//
// Read-only on purpose. Unlike `loadMember`, nothing here creates a principal:
// a user with no principal row has nothing in the drive yet, so they are not
// a drive member (the rule SR-Drive has always applied).

import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { accessGroup, activityPrincipals, allowedUser } from '$lib/db/schema';
import { levelOf, type Level } from '$lib/access/catalogue';
import { asList, effectivePermissions } from '$lib/access/effective';
import { isOwnerEmail } from './access';

/** The only audience that receives a principal id and Drive grants. */
export const DRIVE_AUDIENCE = 'sr-drive';

/** The shapes the gateway accepts (identity.mjs); anything else is dropped here first. */
const PRINCIPAL = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const PERMISSION = /^[a-z][a-z0-9.-]{0,47}:[a-z][a-z0-9-]{0,31}$/;
export const MAX_PEOPLE = 64;
const MAX_LABEL = 120;

export interface DriveClaims {
  pid: string;
  drive: { level: Level; grants: string[]; people: Record<string, string> };
}

function label(raw: string, id: string): string {
  const trimmed = raw.trim().slice(0, MAX_LABEL);
  return trimmed || id;
}

/**
 * The Drive member claims for an effective (already allow-listed) email, or null.
 *
 * Null for the owner — Drive decides the owner from its own env allow-list, so
 * the owner keeps the drive even when this database does not answer — and for
 * anyone without a principal or a drive level. `people` is every name this
 * member may see: their own at `self` (the household's is fixed in Drive);
 * every user principal at `all` and `admin`, whose files they can read and,
 * at admin, write. Capped; a principal past the cap shows as its id and is
 * not a folder an admin may create files under (fails closed).
 */
export async function driveClaimsFor(email: string): Promise<DriveClaims | null> {
  const e = email.trim().toLowerCase();
  if (!e || isOwnerEmail(e)) return null;

  const [row] = await db
    .select({
      role: allowedUser.role,
      groups: allowedUser.groups,
      grants: allowedUser.grants,
      principalId: activityPrincipals.id,
      label: activityPrincipals.label,
    })
    .from(allowedUser)
    .leftJoin(
      activityPrincipals,
      and(eq(activityPrincipals.kind, 'user'), eq(activityPrincipals.externalRef, allowedUser.email)),
    )
    .where(eq(allowedUser.email, e))
    .limit(1);
  if (!row?.principalId || !PRINCIPAL.test(row.principalId)) return null;

  const groupIds = asList(row.groups).filter((id): id is string => typeof id === 'string');
  const groupRows = groupIds.length
    ? await db
        .select({ id: accessGroup.id, grants: accessGroup.grants })
        .from(accessGroup)
        .where(inArray(accessGroup.id, groupIds))
    : [];
  const grants = effectivePermissions(row, new Map(groupRows.map((g) => [g.id, g.grants])));
  const level = levelOf(grants, 'drive');
  if (!level) return null;

  const people: Record<string, string> = { [row.principalId]: label(row.label ?? '', row.principalId) };
  if (level !== 'self') {
    const others = await db
      .select({ id: activityPrincipals.id, label: activityPrincipals.label })
      .from(activityPrincipals)
      .where(eq(activityPrincipals.kind, 'user'))
      .orderBy(asc(activityPrincipals.id))
      .limit(MAX_PEOPLE + 1);
    for (const p of others) {
      if (Object.keys(people).length >= MAX_PEOPLE) {
        console.warn(`[session] drive directory capped at ${MAX_PEOPLE} principals`);
        break;
      }
      if (PRINCIPAL.test(p.id)) people[p.id] = label(p.label, p.id);
    }
  }

  return {
    pid: row.principalId,
    drive: { level, grants: [...grants].filter((g) => PERMISSION.test(g)).sort(), people },
  };
}
