// Family photos — storage. The rules are in ./photos (PURE); this file reads
// and writes `family_photo`.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { familyPhoto } from '$lib/db/schema';
import { getOwnerEmails, isOwnerEmail } from '$lib/server/access';
import { familyRole } from '$lib/server/family-access';
import { senderSubjects } from './messages.server';
import { familyId } from './roster.server';
import { photoEntries, photoIds, photoKey, photoVersion, type PhotoEntry } from './photos';

function keyOf(email: string): string {
  return photoKey(email, getOwnerEmails(), isOwnerEmail);
}

/** Store (or replace) `email`'s photo. Answers its version. */
export async function putPhoto(email: string, bytes: Buffer, now = new Date()): Promise<string> {
  const version = photoVersion(bytes);
  await db
    .insert(familyPhoto)
    .values({ email: keyOf(email), image: bytes, version, updatedAt: now })
    .onConflictDoUpdate({ target: familyPhoto.email, set: { image: bytes, version, updatedAt: now } });
  return version;
}

/** Remove `email`'s photo. Removing none is not an error. */
export async function deletePhoto(email: string): Promise<void> {
  await db.delete(familyPhoto).where(eq(familyPhoto.email, keyOf(email)));
}

/**
 * The stored photos of people who are in the family NOW — a row left behind
 * by someone whose family grant was withdrawn is not shown — without bytes.
 */
async function familyRows(): Promise<Array<{ email: string; version: string }>> {
  const rows = await db.select({ email: familyPhoto.email, version: familyPhoto.version }).from(familyPhoto);
  const roles = await Promise.all(rows.map((r) => familyRole(r.email)));
  return rows.filter((_, i) => roles[i] !== null);
}

/** Everyone in the family with a photo: ids, household subjects and versions. */
export async function familyPhotos(): Promise<PhotoEntry[]> {
  const rows = await familyRows();
  if (!rows.length) return [];
  return photoEntries(rows, getOwnerEmails(), isOwnerEmail, familyId, await senderSubjects());
}

/** The photo behind a phone's id, or null when that person has none (or is not family). */
export async function photoById(id: string): Promise<{ image: Buffer; version: string } | null> {
  const owners = getOwnerEmails();
  const row = (await familyRows()).find((r) => photoIds(r.email, owners, isOwnerEmail, familyId).includes(id));
  if (!row) return null;
  const [found] = await db
    .select({ image: familyPhoto.image, version: familyPhoto.version })
    .from(familyPhoto)
    .where(eq(familyPhoto.email, row.email))
    .limit(1);
  return found ?? null;
}
