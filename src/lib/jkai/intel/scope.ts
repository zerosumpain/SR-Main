// Whose intel a reader may see.
//
// A SPACE is a principal id: 'owner' (the existing activity principal every
// AUTH_ALLOWED_EMAILS address maps to), 'household' (shared), and in PR B one
// `u_…` per family member. Every intel note, entity and edge carries one, and a
// reader passes the set it may see. Everyone's scope is their own space plus
// household — the owner's included, so a family member's email-derived graph
// never reaches the owner's chat either.
//
// Library readers default their `scope` parameter to OWNER_INTEL_SCOPE. That
// keeps every existing owner call site correct without an edit; a surface a
// member can reach must pass the scope `resolveRequestScope` returns instead.
import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import { pgTextArray } from '$lib/db/sql-array';

export const OWNER_SPACE = 'owner';
export const HOUSEHOLD_SPACE = 'household';

export type IntelScope = readonly string[];

export const OWNER_INTEL_SCOPE: IntelScope = Object.freeze([OWNER_SPACE, HOUSEHOLD_SPACE]);

/** Stable cache key for a scope — the analysis cache is one entry per key. */
export function scopeKey(scope: IntelScope): string {
  return [...scope].sort().join(',');
}

/**
 * The UI's space chips, applied to what the caller may see. A request can only
 * narrow: anything outside `allowed` is dropped, and an empty request means the
 * whole of `allowed` (the picker's "nothing selected = no filter" rule).
 */
export function narrowScope(allowed: IntelScope, requested: readonly string[]): IntelScope {
  if (requested.length === 0) return allowed;
  return allowed.filter((s) => requested.includes(s));
}

/** `column = ANY('{…}'::text[])` — the one predicate every scoped reader adds. */
export function spaceIn(column: SQL | AnyColumn, scope: IntelScope): SQL {
  return sql`${column} = ANY(${pgTextArray(scope)}::text[])`;
}

/**
 * The space a write lands in, for an artefact a reader creates (an insight, a
 * lens, a watchlist entry) rather than a row derived from a note — those take
 * the note's space instead. A reader's scope is always `[own, 'household']`,
 * own first (see `resolveRequestScope`), so the head is the reader's own space:
 * what they make is theirs, never silently shared with the household.
 */
export function writeSpace(scope: IntelScope): string {
  const own = scope[0];
  if (!own) throw new Error('writeSpace: empty scope — no space to write into');
  return own;
}
