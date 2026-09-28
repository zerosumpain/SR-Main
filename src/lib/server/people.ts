// /admin/access reads and changes PEOPLE here — one human, whatever records
// they are spread across (see ./people-join). Owner-only callers: every route
// using this sits under /admin, which the hook denies to anyone else.
//
// Spec: docs/superpowers/specs/2026-09-28-people-and-app-registration.md

import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { allowedUser, nativeCredentials } from '$lib/db/schema';
import { parsePermissions } from '$lib/access/catalogue';
import { mergeDeviceRows, type DeviceRow } from '$lib/access/device-rows';
import { listMembers, updateMember, type HouseholdMember } from '$lib/home/presence/members';
import { listPilotDevices, revokePilotDevice } from '$lib/home/presence/companion-accounts';
import { getOwnerEmails } from './access';
import { asList, listGroups } from './grants';
import { disableMemberGmail } from './members';
import { listAllSiteDevices } from './site-devices';
import { findPerson, joinPeople, type Person, type RoleView } from './people-join';

export type { Person, RoleView };

export interface PeopleData {
  people: Person[];
  roles: RoleView[];
  household: HouseholdMember[];
  /** A lane that could not be read, in words; its phones are missing from the rows. */
  deviceWarnings: string[];
}

export async function loadPeople(): Promise<PeopleData> {
  const [groups, accounts, household, site, pilot] = await Promise.all([
    listGroups(),
    db.select().from(allowedUser).orderBy(desc(allowedUser.createdAt)),
    listMembers(),
    listAllSiteDevices().then(
      (v) => ({ ok: true as const, value: v }),
      () => ({ ok: false as const }),
    ),
    listPilotDevices(),
  ]);
  const roles: RoleView[] = groups.map((g) => ({
    id: g.id,
    label: g.label,
    description: g.description,
    grants: parsePermissions(asList(g.grants)),
    builtIn: g.builtIn,
  }));
  // Names come from the join itself, so the device rows need none here.
  const devices: DeviceRow[] = mergeDeviceRows(
    site.ok ? site.value : [],
    pilot.ok ? pilot.value : [],
    new Map(),
    new Date(),
  );
  const deviceWarnings = [
    ...(site.ok ? [] : ['The site’s phone list could not be read.']),
    ...(pilot.ok ? [] : ['The app server’s phone list could not be read.']),
  ];
  const people = joinPeople({ owners: getOwnerEmails(), accounts, roles, household, devices });
  return { people, roles, household, deviceWarnings };
}

export async function loadPerson(key: string): Promise<(PeopleData & { person: Person }) | null> {
  const data = await loadPeople();
  const person = findPerson(data.people, key);
  return person ? { ...data, person } : null;
}

export interface RemoveReport {
  sitePhones: number;
  appPhones: number;
  householdUnlinked: boolean;
  /** Set when the app server could not be reached: its phones still work. */
  appError: string | null;
}

/**
 * Take someone's account away, all of it: the allow-list row, every phone on
 * both lanes, and the household row's link to their email (a row on the app
 * with no email maps nobody, so it drops to 'none'). Their material and the
 * app server's stored data stay — deleting data is its own, explicit action.
 */
export async function removePerson(email: string): Promise<RemoveReport> {
  const e = email.trim().toLowerCase();
  await disableMemberGmail(e);
  await db.delete(allowedUser).where(eq(allowedUser.email, e));

  const site = await db
    .update(nativeCredentials)
    .set({ revokedAt: new Date() })
    .where(and(eq(nativeCredentials.ownerEmail, e), isNull(nativeCredentials.revokedAt)))
    .returning({ id: nativeCredentials.id });

  let appPhones = 0;
  let appError: string | null = null;
  const pilot = await listPilotDevices();
  if (pilot.ok) {
    for (const d of pilot.value.filter((d) => d.email === e)) {
      const r = await revokePilotDevice(d.id);
      if (r.ok) appPhones++;
      else appError = 'Some app phones could not be signed out.';
    }
  } else if (pilot.reason !== 'unconfigured') {
    appError = 'The app server could not be reached, so their app phones still work. Revoke them from Phones.';
  }

  let householdUnlinked = false;
  const member = (await listMembers()).find((m) => m.email === e);
  if (member) {
    await updateMember(member.subject, {
      email: null,
      ...(member.source === 'companion' ? { source: 'none' as const } : {}),
    });
    householdUnlinked = true;
  }
  return { sitePhones: site.length, appPhones, householdUnlinked, appError };
}
