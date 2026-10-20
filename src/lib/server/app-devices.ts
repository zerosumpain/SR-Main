// Phones enrolled for the ad-hoc copy of the iPhone app (`app_device`), and
// the addresses a join link may have been minted for. The pure half of the
// install path is `./adhoc-install`; this is the part that touches the
// database.

import { asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { allowedUser, appDevice, householdMember } from '$lib/db/schema';
import { getOwnerEmails } from './access';

export interface AppDeviceRow {
  id: string;
  udid: string;
  email: string;
  name: string;
  product: string | null;
  osVersion: string | null;
  enrolledAt: Date;
  lastBuildAt: Date | null;
}

/**
 * Every address a join link could have been minted for: the owner, everyone
 * on the allow-list, everyone in the household with an address. The link's
 * tag is an HMAC over its person's address, so verifying it means trying
 * each — a few hundred HMACs at the very most.
 */
export async function joinCandidates(): Promise<string[]> {
  const [listed, household] = await Promise.all([
    db.select({ email: allowedUser.email }).from(allowedUser),
    db.select({ email: householdMember.email }).from(householdMember),
  ]);
  const all = new Set<string>(getOwnerEmails());
  for (const r of listed) all.add(r.email.toLowerCase());
  for (const r of household) if (r.email) all.add(r.email.toLowerCase());
  return [...all];
}

/**
 * A phone has posted its UDID from someone's join link. One row per UDID: a
 * phone enrolled again (a new link, a second profile) keeps its row and takes
 * the newest facts, and a phone once removed is back.
 */
export async function recordEnrolment(input: {
  udid: string;
  email: string;
  name: string;
  product: string | null;
  osVersion: string | null;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(appDevice)
    .values({ ...input, email: input.email.toLowerCase(), lastBuildAt: now })
    .onConflictDoUpdate({
      target: appDevice.udid,
      set: { email: input.email.toLowerCase(), name: input.name, product: input.product, osVersion: input.osVersion, lastBuildAt: now, removedAt: null },
    });
}

/** Enrolled phones, oldest first, removed ones left out. Never the UDID beyond this server. */
export async function listAppDevices(): Promise<AppDeviceRow[]> {
  return db
    .select({
      id: appDevice.id,
      udid: appDevice.udid,
      email: appDevice.email,
      name: appDevice.name,
      product: appDevice.product,
      osVersion: appDevice.osVersion,
      enrolledAt: appDevice.enrolledAt,
      lastBuildAt: appDevice.lastBuildAt,
    })
    .from(appDevice)
    .where(isNull(appDevice.removedAt))
    .orderBy(asc(appDevice.email), desc(appDevice.enrolledAt));
}

/** Forget an enrolled phone here. It stays in the signing profile until the next build drops it. */
export async function removeAppDevice(id: string): Promise<boolean> {
  const rows = await db.update(appDevice).set({ removedAt: new Date() }).where(eq(appDevice.id, id)).returning({ id: appDevice.id });
  return rows.length > 0;
}
