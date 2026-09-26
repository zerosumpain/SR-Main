import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { nativeCredentials } from '$lib/db/schema';

/**
 * The credential a paired iPhone presents, and the one-time code that mints it.
 *
 * ## Why this is not `invoke-auth`
 *
 * The three lanes already in `hooks.server.ts` — `invoke-auth`, `studio-auth`,
 * the jkai bridge — all compare against a STATIC environment variable, because
 * what they authenticate is a SERVICE. One secret, one caller, rotated by hand.
 *
 * A phone is not a service. There can be several, they are lost and replaced,
 * and the answer to "revoke this one" must not be "rotate the variable and
 * redeploy every other caller". So the credential lives in a row, and the row
 * is what gets revoked. The comparison discipline below is still `invoke-auth`'s
 * — length floor, no dev fallback, constant time — because the failure modes of
 * comparing a bearer token do not change with where it is stored.
 *
 * ## Why only the hash is stored
 *
 * The website renders a device list. If that list could show a working token,
 * the page would be a credential store, and every future cache, log line and
 * screenshot of it would be too. Hashing means a row is sufficient to REVOKE a
 * phone and never sufficient to BECOME one.
 *
 * ## Why the lane does not identify a person
 *
 * It identifies an OWNER — `ownerEmail` is stamped from the session that minted
 * the pairing code, and every handler re-derives the allow-list check from it.
 * A device token is therefore exactly as privileged as the browser session that
 * created it and no more, which is what makes "pair my phone" a safe thing for
 * the owner to do and a useless thing for anybody else to steal a QR of.
 *
 * A MEMBER (a non-owner holding news or chat, `$lib/server/grants`) can hold a
 * device too, since the member device lane. Their code is never minted from a
 * request: only the household push mints one, for a member who asked from the
 * app (`$lib/home/presence/app-view`). The row still carries just an email, and
 * everything the member may do is re-derived from that email's grants on every
 * request (`withNativeAccess`), so a demotion takes effect on the next call.
 */

/** A device token below this length is not a credential. Matches `invoke-auth`. */
const MIN_TOKEN_LEN = 32;

/** Ten minutes, the same window the companion pilot's pairing code uses. */
export const PAIR_CODE_TTL_MS = 10 * 60 * 1000;

/** Ninety days. Long enough not to be a chore, short enough to be a backstop. */
export const DEVICE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export type CredentialKind = 'pair' | 'device';

export interface NativeIdentity {
  id: string;
  ownerEmail: string;
  label: string | null;
  expiresAt: Date;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The bearer token this request presents, or ''.
 *
 * Verbatim from `invoke-auth.presentedToken` — a second spelling of "is this
 * header shaped like a bearer" is a second place for the two to disagree.
 */
function presentedToken(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

/**
 * Compare two hex digests without leaking where they diverge.
 *
 * Both sides are SHA-256 hex here, so the length guard can never fire in
 * practice — it is kept because `timingSafeEqual` THROWS on unequal buffers and
 * the throw is itself an oracle, which is the trap `invoke-auth` documents.
 */
function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** 256 bits, base64url — comfortably over the length floor. */
function mintSecret(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Mint a one-time pairing code for `ownerEmail`.
 *
 * Minting invalidates any code the same owner already holds. Two live codes
 * would mean a QR left on a second screen still works after this one is shown,
 * and the companion pilot deletes the previous row for exactly that reason.
 */
export async function createPairingCode(
  ownerEmail: string,
): Promise<{ code: string; expiresAt: Date }> {
  const owner = ownerEmail.trim().toLowerCase();
  if (!owner) throw new Error('A pairing code needs an owner.');

  await db
    .delete(nativeCredentials)
    .where(and(eq(nativeCredentials.ownerEmail, owner), eq(nativeCredentials.kind, 'pair')));

  const code = mintSecret();
  const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MS);
  await db.insert(nativeCredentials).values({
    kind: 'pair',
    ownerEmail: owner,
    tokenHash: sha256(code),
    label: 'One-time pairing',
    expiresAt,
  });
  return { code, expiresAt };
}

/**
 * Is this pairing code still redeemable — unexpired, unrevoked, not yet spent?
 *
 * For the one caller that holds a code in memory between uses: the household
 * push (`$lib/home/presence/app-view`) re-sends a member's code every cycle
 * rather than minting a fresh one, and a code the phone has already redeemed
 * (its row deleted by `redeemPairingCode`) must stop being re-sent the moment
 * it is spent, not when its clock runs out.
 */
export async function isPairingCodeLive(code: string): Promise<boolean> {
  const presented = code.trim();
  if (!presented) return false;
  const [row] = await db
    .select({ id: nativeCredentials.id })
    .from(nativeCredentials)
    .where(
      and(
        eq(nativeCredentials.tokenHash, sha256(presented)),
        eq(nativeCredentials.kind, 'pair'),
        gt(nativeCredentials.expiresAt, new Date()),
        isNull(nativeCredentials.revokedAt),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Exchange a pairing code for a device token.
 *
 * The code row is DELETED before the device row is written, so a replayed code
 * cannot mint a second token even if two requests arrive together — the delete
 * reports how many rows it removed, and losing that race means removing none.
 */
export async function redeemPairingCode(
  code: string,
  label: string | null,
): Promise<{ token: string; ownerEmail: string; expiresAt: Date } | null> {
  const presented = code.trim();
  if (!presented) return null;

  const [row] = await db
    .select()
    .from(nativeCredentials)
    .where(
      and(
        eq(nativeCredentials.tokenHash, sha256(presented)),
        eq(nativeCredentials.kind, 'pair'),
        gt(nativeCredentials.expiresAt, new Date()),
        isNull(nativeCredentials.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  // Re-compare in constant time. The lookup above matched on an indexed hash,
  // which is a fast path and not a decision — this is the decision.
  if (!digestsMatch(row.tokenHash, sha256(presented))) return null;

  const deleted = await db
    .delete(nativeCredentials)
    .where(eq(nativeCredentials.id, row.id))
    .returning({ id: nativeCredentials.id });
  // Lost the race against a concurrent redemption of the same code. The other
  // caller got the token; this one gets nothing.
  if (deleted.length === 0) return null;

  const token = mintSecret();
  const expiresAt = new Date(Date.now() + DEVICE_TOKEN_TTL_MS);
  await db.insert(nativeCredentials).values({
    kind: 'device',
    ownerEmail: row.ownerEmail,
    tokenHash: sha256(token),
    label: label?.trim() ? label.trim().slice(0, 60) : 'iPhone',
    expiresAt,
  });
  return { token, ownerEmail: row.ownerEmail, expiresAt };
}

/**
 * Who this request's bearer token belongs to, or null.
 *
 * Null covers every failure identically — absent, malformed, too short,
 * unknown, expired, revoked — because telling a caller WHICH is telling it
 * where to aim next.
 */
export async function identifyDevice(request: Request): Promise<NativeIdentity | null> {
  const presented = presentedToken(request);
  if (presented.length < MIN_TOKEN_LEN) return null;

  const [row] = await db
    .select()
    .from(nativeCredentials)
    .where(
      and(
        eq(nativeCredentials.tokenHash, sha256(presented)),
        eq(nativeCredentials.kind, 'device'),
        gt(nativeCredentials.expiresAt, new Date()),
        isNull(nativeCredentials.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (!digestsMatch(row.tokenHash, sha256(presented))) return null;

  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    label: row.label,
    expiresAt: row.expiresAt,
  };
}

/**
 * Stamp last-seen for a device that has just been served.
 *
 * Deliberately fire-and-forget at the call site: this is telemetry for the
 * device list, and a write failing here must never turn a good request into a
 * bad one.
 */
export async function touchDevice(id: string): Promise<void> {
  await db
    .update(nativeCredentials)
    .set({ lastUsedAt: new Date(), useCount: sql`${nativeCredentials.useCount} + 1` })
    .where(eq(nativeCredentials.id, id));
}

/** Revoke one device. Returns whether a row of this owner's actually moved. */
export async function revokeDevice(ownerEmail: string, id: string): Promise<boolean> {
  const rows = await db
    .update(nativeCredentials)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(nativeCredentials.id, id),
        eq(nativeCredentials.ownerEmail, ownerEmail.trim().toLowerCase()),
        isNull(nativeCredentials.revokedAt),
      ),
    )
    .returning({ id: nativeCredentials.id });
  return rows.length > 0;
}

/** Every device this owner has paired, newest first. Never includes a secret. */
export async function listDevices(ownerEmail: string) {
  const rows = await db
    .select({
      id: nativeCredentials.id,
      label: nativeCredentials.label,
      createdAt: nativeCredentials.createdAt,
      expiresAt: nativeCredentials.expiresAt,
      revokedAt: nativeCredentials.revokedAt,
      lastUsedAt: nativeCredentials.lastUsedAt,
      useCount: nativeCredentials.useCount,
    })
    .from(nativeCredentials)
    .where(
      and(
        eq(nativeCredentials.ownerEmail, ownerEmail.trim().toLowerCase()),
        eq(nativeCredentials.kind, 'device'),
      ),
    )
    .orderBy(desc(nativeCredentials.createdAt));
  return rows;
}

/**
 * Drop expired pairing codes and long-dead device rows.
 *
 * A revoked or expired device row is kept for a grace period so the website can
 * still say "this phone was revoked" rather than silently forgetting it ever
 * existed; past that it is noise.
 */
export async function pruneCredentials(): Promise<number> {
  const now = new Date();
  const grace = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .delete(nativeCredentials)
    .where(
      or(
        and(eq(nativeCredentials.kind, 'pair'), lt(nativeCredentials.expiresAt, now)),
        and(eq(nativeCredentials.kind, 'device'), lt(nativeCredentials.expiresAt, grace)),
      ),
    )
    .returning({ id: nativeCredentials.id });
  return rows.length;
}
