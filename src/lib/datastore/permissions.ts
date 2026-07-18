// $lib/datastore/permissions.ts
//
// The ONE place row-level access is decided. Nodes / tools / admin UI never
// re-implement these checks — they pass an explicit `actor` and the access layer
// funnels every read/write/delete through `assertCan`.
//
// Rules:
//   - `owner` always passes every action (John can never be locked out).
//   - `*` in a list matches every actor.
//   - `workflow:*` in a list matches any concrete `workflow:<id>` actor.
//   - otherwise the actor must be listed verbatim.
//
// Resolution precedence: record.permissions → collection.defaultPermissions →
// built-in creator default `{read/write/delete: [creator, 'owner', 'jkai']}`
// (deduplicated). Any action key absent from the chosen source falls back to the
// built-in default for that action.

import { DatastoreError } from './types';
import type {
  DatastoreCollection,
  DatastoreRecord,
  PermissionSet,
} from './types';

export type PermissionAction = 'read' | 'write' | 'delete';

/** Dedupe preserving first-occurrence order. */
function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/** Built-in fallback capability list for a given creator. */
function builtinDefault(creator: string): string[] {
  return dedupe([creator, 'owner', 'jkai']);
}

/**
 * Resolve the effective capability map for a record, filling any absent action
 * from the built-in creator default. Returns a fully-populated PermissionSet.
 */
export function resolvePermissions(
  record: Pick<DatastoreRecord, 'permissions' | 'createdBy'>,
  collection: Pick<DatastoreCollection, 'defaultPermissions' | 'createdBy'>,
): Required<PermissionSet> {
  const creator = record.createdBy ?? collection.createdBy ?? 'owner';
  const fallback = builtinDefault(creator);
  const source: PermissionSet | null = record.permissions ?? collection.defaultPermissions ?? null;

  const pick = (action: PermissionAction): string[] => {
    const fromSource = source?.[action];
    return Array.isArray(fromSource) ? fromSource : fallback;
  };

  return {
    read: pick('read'),
    write: pick('write'),
    delete: pick('delete'),
  };
}

/** Does a single capability list grant `actor` access? */
function listGrants(list: string[] | undefined, actor: string): boolean {
  if (!list) return false;
  for (const entry of list) {
    if (entry === '*') return true;
    if (entry === actor) return true;
    if (entry === 'workflow:*' && actor.startsWith('workflow:')) return true;
  }
  return false;
}

/** Non-throwing capability check. `owner` always passes. */
export function canDo(
  action: PermissionAction,
  perms: PermissionSet,
  actor: string,
): boolean {
  if (actor === 'owner') return true;
  return listGrants(perms[action], actor);
}

/** Throwing capability check — raises `DatastoreError('forbidden')` on deny. */
export function assertCan(
  action: PermissionAction,
  perms: PermissionSet,
  actor: string,
): void {
  if (!canDo(action, perms, actor)) {
    throw new DatastoreError(
      'forbidden',
      `actor "${actor}" is not permitted to ${action} this resource`,
    );
  }
}
