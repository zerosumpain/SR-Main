// Who is in the family, for the steps board and the task list.
//
// A member is the owner, or anyone holding `family:circle` or `family:admin`
// (`familyLevel` in $lib/access/roles). A PARENT is the owner or `family:admin`.
// Candidates come from everywhere a family person shows up — the iPhone app's
// pilot users (the list `pushAppViews` walks), the household roster and the
// live site pairings — and each is checked against their grants, read fresh.
//
// A person's id is a keyed hash of their email (`playerId`'s pattern, prefix
// `f_`), so the phone never carries anybody else's address.

import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { familyRole } from '$lib/server/family-access';
import { listAllSiteDevices } from '$lib/server/site-devices';
import { listMembers } from '$lib/home/presence/members';
import { loadCompanionUsers } from '$lib/home/presence/companion';

export interface FamilyPerson {
  id: string;
  email: string;
  name: string;
  parent: boolean;
  /** Has an account on the iPhone app's pilot — the steps board's source. */
  pilot: boolean;
  stepsSharing?: boolean;
}

export function familyId(email: string): string {
  const key = env.AUTH_SECRET || 'sr-family';
  return 'f_' + createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex').slice(0, 12);
}

export function nameFromEmail(email: string): string {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local ? local[0].toUpperCase() + local.slice(1) : email;
}

const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase();

export { familyRole } from '$lib/server/family-access';

/** Reset between tests, and after a write that changes who is in. */
export function resetFamilyRoster(): void {
  // Retained for callers/tests; each read now resolves current grants and consent.
}

export async function familyRoster(now = Date.now()): Promise<FamilyPerson[]> {
  // Consent and grants are checked on every read, including board delivery.

  const names = new Map<string, string>();
  const pilot = new Set<string>();
  const stepsSharing = new Set<string>();
  const candidates = new Set<string>();

  for (const u of (await loadCompanionUsers().catch(() => null)) ?? []) {
    const e = norm(u.email);
    if (!e) continue;
    pilot.add(e);
    if (u.stepsSharing === true) stepsSharing.add(e);
    candidates.add(e);
    if (u.name && u.name !== u.email) names.set(e, u.name);
  }
  // The household roster's name wins over the pilot's: it is what the site calls them.
  for (const m of await listMembers().catch(() => [])) {
    const e = norm(m.email);
    if (!e) continue;
    candidates.add(e);
    names.set(e, m.displayName);
  }
  for (const d of await listAllSiteDevices().catch(() => [])) {
    if (d.revokedAt || d.expiresAt.getTime() <= now) continue;
    candidates.add(norm(d.ownerEmail));
  }

  const people: FamilyPerson[] = [];
  for (const email of candidates) {
    if (!email) continue;
    const role = await familyRole(email);
    if (!role) continue;
    people.push({
      id: familyId(email),
      email,
      name: names.get(email) ?? nameFromEmail(email),
      parent: role.parent,
      pilot: pilot.has(email),
      stepsSharing: stepsSharing.has(email),
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return people;
}

/** The caller as a family person, whether or not the roster has caught up with them. */
export async function familyPersonFor(email: string, parent: boolean): Promise<FamilyPerson> {
  const e = norm(email);
  const known = (await familyRoster()).find((p) => p.email === e);
  if (known) return { ...known, parent };
  const member = await listMembers()
    .then((all) => all.find((m) => norm(m.email) === e))
    .catch(() => undefined);
  return { id: familyId(e), email: e, name: member?.displayName ?? nameFromEmail(e), parent, pilot: false };
}
