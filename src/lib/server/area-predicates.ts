// The row predicates of the area seam — pure, no SvelteKit import.
//
// Split out of `area-scope.ts` so library code that runs outside a request
// (research search, which the chat tools and so the WhatsApp worker bundle)
// can scope rows without dragging `@sveltejs/kit` into a sidecar bundle —
// `build:release-sidecars` refuses that. The seam that resolves a request's
// access is still `areaAccess` in `area-scope.ts`.

import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import type { Level } from '$lib/access/catalogue';

export const OWNER_PRINCIPAL = 'owner';
export const HOUSEHOLD_PRINCIPAL = 'household';

export type AreaAccess = { level: 'owner' | Level; own: string };

export const OWNER_ACCESS: AreaAccess = Object.freeze({ level: 'owner', own: OWNER_PRINCIPAL });

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

