// One row per HUMAN for /admin/access, joined from the records a person is
// spread across: the owner list (env), the allow-list, the household table and
// both phone lanes. Everything joins on the lower-cased email; a household row
// with no email is a person with no account (the Life360-only children).
//
// PURE — the loader in ./people.server fetches, this joins, and the test drives it.
//
// Spec: docs/superpowers/specs/2026-09-28-people-and-app-registration.md

import { parsePermissions, type Permission } from '$lib/access/catalogue';
import { asList, effectivePermissions } from '$lib/access/effective';
import { familyLevel, pruneAdds, strongestRole, summarise, type FamilyLevel } from '$lib/access/roles';
import type { HouseholdMember } from '$lib/home/presence/members';
import type { DeviceRow } from '$lib/access/device-rows';

export interface RoleView {
  id: string;
  label: string;
  description: string | null;
  grants: Permission[];
  builtIn: boolean;
}

export interface AccountIn {
  email: string;
  note: string | null;
  role: string;
  groups: unknown;
  grants: unknown;
  aliases?: unknown;
  createdAt: Date;
}

export type PersonKind = 'owner' | 'account' | 'household';

export interface Person {
  /** The URL key: their household subject when they have a row, else their email. */
  key: string;
  kind: PersonKind;
  name: string;
  email: string | null;
  createdAt: Date | null;
  /** The one role (null for none, and always null for the owner). */
  roleId: string | null;
  roleLabel: string | null;
  /** Grants on top of the role, pruned (a legacy role's grant carried in). */
  adds: Permission[];
  /** Everything they hold. Empty for the owner, who holds everything. */
  effective: Permission[];
  family: FamilyLevel;
  /** "chat, news, games" — the areas held, for the list row. */
  summary: string[];
  household: HouseholdMember | null;
  devices: DeviceRow[];
  /** Other addresses that are this person (an Apple relay, once a Google one was linked). */
  aliases: string[];
}

/** What a pre-groups `role` held, carried in so the editor starts from the truth. */
const LEGACY: Record<string, Permission> = { member: 'jkai.intel:self', household: 'family:circle' };

function nameFrom(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export function joinPeople(input: {
  owners: readonly string[];
  accounts: readonly AccountIn[];
  roles: readonly RoleView[];
  household: readonly HouseholdMember[];
  devices: readonly DeviceRow[];
}): Person[] {
  const roleGrants = new Map(input.roles.map((r) => [r.id, r.grants]));
  const roleLabel = new Map(input.roles.map((r) => [r.id, r.label]));
  const byEmail = new Map<string, HouseholdMember>();
  for (const m of input.household) if (m.email) byEmail.set(m.email.toLowerCase(), m);
  const devicesOf = (email: string | null) =>
    email ? input.devices.filter((d) => d.email === email && d.status === 'active') : [];

  const people: Person[] = [];
  const claimed = new Set<string>();

  for (const raw of input.owners) {
    const email = raw.toLowerCase();
    const household = byEmail.get(email) ?? null;
    if (household) claimed.add(household.subject);
    people.push({
      key: household?.subject ?? email,
      kind: 'owner',
      name: household?.displayName ?? nameFrom(email),
      email,
      createdAt: null,
      roleId: null,
      roleLabel: null,
      adds: [],
      effective: [],
      family: 'parent',
      summary: [],
      household,
      devices: devicesOf(email),
      aliases: [],
    });
  }

  const owners = new Set(input.owners.map((e) => e.toLowerCase()));
  for (const a of input.accounts) {
    const email = a.email.toLowerCase();
    if (owners.has(email)) continue;
    const household = byEmail.get(email) ?? null;
    if (household) claimed.add(household.subject);
    const stored = asList(a.groups).filter((g): g is string => typeof g === 'string');
    const roleId = strongestRole(stored, roleGrants);
    const legacy = LEGACY[a.role];
    const own = parsePermissions(asList(a.grants));
    const adds = pruneAdds(roleId ? (roleGrants.get(roleId) ?? []) : [], legacy ? [...own, legacy] : own);
    const effective = [...effectivePermissions({ role: 'guest', groups: roleId ? [roleId] : [], grants: adds }, roleGrants)];
    people.push({
      key: household?.subject ?? email,
      kind: 'account',
      name: household?.displayName ?? (a.note?.trim() || nameFrom(email)),
      email,
      createdAt: a.createdAt,
      roleId,
      roleLabel: roleId ? (roleLabel.get(roleId) ?? roleId) : null,
      adds,
      effective,
      family: familyLevel(effective),
      summary: summarise(effective),
      household,
      devices: devicesOf(email),
      aliases: asList(a.aliases).filter((x): x is string => typeof x === 'string'),
    });
  }

  for (const m of input.household) {
    if (claimed.has(m.subject)) continue;
    people.push({
      key: m.subject,
      kind: 'household',
      name: m.displayName,
      email: m.email,
      createdAt: null,
      roleId: null,
      roleLabel: null,
      adds: [],
      effective: [],
      family: 'none',
      summary: [],
      household: m,
      devices: devicesOf(m.email),
      aliases: [],
    });
  }

  const order: Record<PersonKind, number> = { owner: 0, account: 1, household: 2 };
  return people.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

/** The person a URL key names: a household subject, or an email. */
export function findPerson(people: readonly Person[], key: string): Person | null {
  const k = key.trim().toLowerCase();
  return people.find((p) => p.key.toLowerCase() === k || p.email === k) ?? null;
}
