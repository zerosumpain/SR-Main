// Family photos — the pure half: reading the JPEG the phone sent, the version
// a phone caches it by, whose row an email writes, and the list the phone
// reads. No database. Storage is ./photos.server.
//
// A family member replaces their initials circle in the iPhone app with a
// photo of themselves. The app crops and compresses it; this checks it is a
// JPEG small enough to hand every family phone, and nothing more.

import { createHash } from 'node:crypto';

/** The largest photo stored, in decoded bytes. The app sends ~40–120 KB. */
export const PHOTO_MAX_BYTES = 300_000;

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * `{ jpeg: "<base64>" }` from the phone, decoded, or a sentence for a 400.
 *
 * Forgiving about the wrapping (line breaks, a `data:image/jpeg;base64,`
 * prefix), strict about the bytes: it must decode, start FF D8 FF, and be at
 * most PHOTO_MAX_BYTES. The size is checked from the text's length first, so
 * a huge upload is refused before it is decoded.
 */
export function parsePhotoUpload(body: unknown): { bytes: Buffer } | { error: string } {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).jpeg : undefined;
  if (typeof raw !== 'string') return { error: 'Send the photo as base64 in "jpeg".' };
  const text = raw.replace(/^data:image\/jpe?g;base64,/i, '').replace(/\s+/g, '');
  if (!text) return { error: 'Send the photo as base64 in "jpeg".' };
  if (!BASE64.test(text) || text.length % 4 === 1) return { error: 'That photo could not be read. Try choosing it again.' };
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  if (Math.floor((text.length * 3) / 4) - padding > PHOTO_MAX_BYTES) {
    return { error: 'That photo is too large. Keep it under 300 KB.' };
  }
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length > PHOTO_MAX_BYTES) return { error: 'That photo is too large. Keep it under 300 KB.' };
  if (bytes.length < JPEG_MAGIC.length || JPEG_MAGIC.some((b, i) => bytes[i] !== b)) {
    return { error: 'The photo must be a JPEG.' };
  }
  return { bytes };
}

/** The version a phone caches a photo by: the first 12 hex of its SHA-256. */
export function photoVersion(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

/**
 * The row an email reads and writes. The owner's addresses are one person,
 * stored under the first allow-listed one, whichever they uploaded from.
 */
export function photoKey(email: string, ownerEmails: readonly string[], isOwner: (email: string) => boolean): string {
  const e = email.trim().toLowerCase();
  if (isOwner(e) && ownerEmails.length) return ownerEmails[0].trim().toLowerCase();
  return e;
}

/**
 * Every id a stored photo answers to. A member has one (`familyId` of their
 * email). The owner appears on the steps board and in messages under
 * whichever of their addresses that surface knows them by, so their photo
 * answers to the id of every owner address.
 */
export function photoIds(
  key: string,
  ownerEmails: readonly string[],
  isOwner: (email: string) => boolean,
  idOf: (email: string) => string,
): string[] {
  const emails = isOwner(key) ? [key, ...ownerEmails] : [key];
  return [...new Set(emails.map((e) => idOf(e.trim().toLowerCase())))];
}

export interface PhotoEntry {
  id: string;
  subject: string | null;
  version: string;
}

/** The list the phone reads: one entry per id each photo answers to. No emails. */
export function photoEntries(
  rows: ReadonlyArray<{ email: string; version: string }>,
  ownerEmails: readonly string[],
  isOwner: (email: string) => boolean,
  idOf: (email: string) => string,
  subjectOf: (email: string) => string | null,
): PhotoEntry[] {
  return rows.flatMap((r) =>
    photoIds(r.email, ownerEmails, isOwner, idOf).map((id) => ({ id, subject: subjectOf(r.email), version: r.version })),
  );
}
