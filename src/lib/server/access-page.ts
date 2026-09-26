// The data /admin/access renders, shared by its page load and every API
// response that changes it (so the page swaps in one fresh copy, never a
// patched one).
import { desc } from 'drizzle-orm';
import { db } from '$lib/db';
import { allowedUser } from '$lib/db/schema';
import { parsePermissions, type Permission } from '$lib/access/catalogue';
import { getOwnerEmails } from './access';
import { effectivePermissions, listGroups } from './grants';

export interface AccessPerson {
  email: string;
  note: string | null;
  addedBy: string | null;
  createdAt: Date;
  groups: string[];
  grants: Permission[];
  /** What they hold, groups and grants together. */
  effective: Permission[];
  /**
   * A pre-groups role the owner has not saved over since: 'member' holds
   * `jkai.intel:self`, 'household' holds `family:circle`.
   */
  legacyRole: 'member' | 'household' | null;
}

export interface AccessGroupView {
  id: string;
  label: string;
  description: string | null;
  grants: Permission[];
  builtIn: boolean;
  members: number;
}

export async function loadAccessPage(): Promise<{
  superAdmins: string[];
  people: AccessPerson[];
  groups: AccessGroupView[];
}> {
  const [groups, rows] = await Promise.all([
    listGroups(),
    db.select().from(allowedUser).orderBy(desc(allowedUser.createdAt)),
  ]);
  const byId = new Map(groups.map((g) => [g.id, g.grants ?? []]));
  const known = new Set(byId.keys());

  const people: AccessPerson[] = rows.map((r) => ({
    email: r.email,
    note: r.note,
    addedBy: r.addedBy,
    createdAt: r.createdAt,
    groups: (r.groups ?? []).filter((g): g is string => typeof g === 'string' && known.has(g)),
    grants: parsePermissions(r.grants),
    effective: [...effectivePermissions(r, byId)],
    legacyRole: r.role === 'member' || r.role === 'household' ? r.role : null,
  }));

  return {
    superAdmins: getOwnerEmails(),
    people,
    groups: groups.map((g) => ({
      id: g.id,
      label: g.label,
      description: g.description,
      grants: parsePermissions(g.grants),
      builtIn: g.builtIn,
      members: people.filter((p) => p.groups.includes(g.id)).length,
    })),
  };
}
