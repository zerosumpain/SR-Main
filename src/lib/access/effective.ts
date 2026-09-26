// What a user's stored access MEANS: their groups' grants plus their own
// one-off grants, filtered through the catalogue.
//
// Pure — it imports only the catalogue — so an application that reads the
// same `allowed_user` / `access_group` rows without this repository's server
// layer (SR-Drive, which holds this file byte for byte) resolves a member's
// permissions exactly as the hook here does. Who holds what is read and
// written by $lib/server/grants, which re-exports both of these.

import { isOpenPermission, parsePermissions, type Permission } from './catalogue';

/** A jsonb list as stored, or empty: a hand-edited `{}` or `"x"` must not throw. */
export function asList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The permissions a user holds.
 *
 * `role = 'member'` / `'household'` are the pre-groups ways of saying "their
 * own intel space" / "the family circle", kept so a row written before this
 * shipped keeps meaning what it meant.
 * `setUserAccess` resets it, so once the owner has saved a user from the new
 * page their groups and grants are the only source.
 */
export function effectivePermissions(
  user: { role: string; groups: unknown; grants: unknown },
  groups: ReadonlyMap<string, unknown>,
): Set<Permission> {
  const out = new Set<Permission>(parsePermissions(asList(user.grants)));
  for (const id of asList(user.groups)) {
    if (typeof id !== 'string') continue;
    for (const p of parsePermissions(asList(groups.get(id)))) out.add(p);
  }
  if (user.role === 'member') out.add('jkai.intel:self');
  if (user.role === 'household') out.add('family:circle');
  // Stored but not held until its area opens (see `isOpenPermission`).
  for (const p of out) if (!isOpenPermission(p)) out.delete(p);
  return out;
}
