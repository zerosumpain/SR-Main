// Whose rows a request may read or change in one area — the seam every area
// that opens to members reads through (spec: access groups §4).
//
// Reaching a route is the hook's decision ($lib/access/catalogue); which ROWS
// come back is this one's. Each area's owned rows carry a `principal_id`:
// 'owner' (John's — the default, so every row that existed before the area
// opened stays his), 'household' (shared), or a member's `u_…`.
//
//   owner / anonymous   everything. Anonymous reaches an authed route only
//                       through an owner-grade lane (maintenance secret,
//                       service token, dev LAN) — the same rule as intel's
//                       `resolveRequestScope`.
//   self                reads own + household, writes own
//   all                 reads every member's + household (never the owner's),
//                       writes own
//   admin               reads and writes every member's + household
//   anyone else         403
//
// The production DB role is a superuser, so Postgres RLS cannot do this; it
// lives here, in code, and every route that reads an area's rows calls it.

import { error } from '@sveltejs/kit';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import { levelOf, type AreaId, type Level } from '$lib/access/catalogue';
import { viewerOf } from './viewer';

export const OWNER_PRINCIPAL = 'owner';
export const HOUSEHOLD_PRINCIPAL = 'household';

export type AreaAccess = { level: 'owner' | Level; own: string };

export const OWNER_ACCESS: AreaAccess = Object.freeze({ level: 'owner', own: OWNER_PRINCIPAL });

export async function areaAccess(event: { locals: App.Locals }, area: AreaId): Promise<AreaAccess> {
  const viewer = await viewerOf(event);
  if (viewer.kind === 'owner' || viewer.kind === 'anonymous') return OWNER_ACCESS;
  if (viewer.kind === 'member') {
    const level = levelOf(viewer.grants, area);
    if (level) return { level, own: viewer.principalId };
  }
  throw error(403, 'Forbidden');
}

/** The rows a reader may see. */
export function readable(column: SQL | AnyColumn, access: AreaAccess): SQL {
  if (access.level === 'owner') return sql`true`;
  if (access.level === 'self') return sql`${column} in (${access.own}, ${HOUSEHOLD_PRINCIPAL})`;
  return sql`${column} <> ${OWNER_PRINCIPAL}`;
}

/** The rows a reader may change. */
export function writable(column: SQL | AnyColumn, access: AreaAccess): SQL {
  if (access.level === 'owner') return sql`true`;
  if (access.level === 'admin') return sql`${column} <> ${OWNER_PRINCIPAL}`;
  return sql`${column} = ${access.own}`;
}

/** `readable`, for one row already in hand. */
export function canRead(principalId: string, access: AreaAccess): boolean {
  if (access.level === 'owner') return true;
  if (access.level === 'self') return principalId === access.own || principalId === HOUSEHOLD_PRINCIPAL;
  return principalId !== OWNER_PRINCIPAL;
}

/** `writable`, for one row already in hand. */
export function canWrite(principalId: string, access: AreaAccess): boolean {
  if (access.level === 'owner') return true;
  if (access.level === 'admin') return principalId !== OWNER_PRINCIPAL;
  return principalId === access.own;
}

