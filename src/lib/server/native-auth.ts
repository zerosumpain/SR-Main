import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { nativeCredentials, householdJourneyViewer } from '$lib/db/schema';
import { phoneTelemetry } from './native-telemetry';

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

/**
 * `pair` is a code handed straight to the phone it is for — by the app's own
 * sign-in, or the household push. `scan` is a code SHOWN, at /welcome or
 * /admin/access/devices, for whoever is signed in to that browser: any camera
 * in the room can read it, so it is redeemed only by a phone that proves it is
 * signed in as that same person (`$lib/server/pair-identity`).
 */
export type CredentialKind = 'pair' | 'scan' | 'device';
const CODE_KINDS = ['pair', 'scan'] as const;

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
 * Mint the one code /welcome shows as a QR. One per person at a time, like
 * `createPairingCode`, but a kind of its own: it does not cancel a `pair` code
 * the household push is holding for the same person, and `/api/native/pair`
 * redeems it only for a phone signed in as them.
 */
export async function createScanCode(ownerEmail: string): Promise<{ code: string; expiresAt: Date }> {
  const owner = ownerEmail.trim().toLowerCase();
  if (!owner) throw new Error('A pairing code needs an owner.');

  await db
    .delete(nativeCredentials)
    .where(and(eq(nativeCredentials.ownerEmail, owner), eq(nativeCredentials.kind, 'scan')));

  const code = mintSecret();
  const expiresAt = new Date(Date.now() + PAIR_CODE_TTL_MS);
  await db.insert(nativeCredentials).values({
    kind: 'scan',
    ownerEmail: owner,
    tokenHash: sha256(code),
    label: 'Scanned pairing',
    expiresAt,
  });
  return { code, expiresAt };
}

/**
 * Whose live code this is, and which kind, without spending it — so the pair
 * route can check who is holding a scanned code before redeeming it. A code
 * refused here stays live for the person it belongs to.
 */
export async function peekPairingCode(code: string): Promise<{ kind: 'pair' | 'scan'; ownerEmail: string } | null> {
  const presented = code.trim();
  if (!presented) return null;
  const [row] = await db
    .select({ kind: nativeCredentials.kind, ownerEmail: nativeCredentials.ownerEmail, tokenHash: nativeCredentials.tokenHash })
    .from(nativeCredentials)
    .where(
      and(
        eq(nativeCredentials.tokenHash, sha256(presented)),
        inArray(nativeCredentials.kind, CODE_KINDS),
        gt(nativeCredentials.expiresAt, new Date()),
        isNull(nativeCredentials.revokedAt),
      ),
    )
    .limit(1);
  if (!row || !digestsMatch(row.tokenHash, sha256(presented))) return null;
  return { kind: row.kind === 'scan' ? 'scan' : 'pair', ownerEmail: row.ownerEmail };
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
export async function isPairingCodeLive(code: string, kind: 'pair' | 'scan' = 'pair'): Promise<boolean> {
  const presented = code.trim();
  if (!presented) return false;
  const [row] = await db
    .select({ id: nativeCredentials.id })
    .from(nativeCredentials)
    .where(
      and(
        eq(nativeCredentials.tokenHash, sha256(presented)),
        eq(nativeCredentials.kind, kind),
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
 *
 * Either kind of code. A `scan` code must have had its holder checked first
 * (`peekPairingCode`, then `/api/native/pair`) — this does not ask who is
 * redeeming it.
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
        inArray(nativeCredentials.kind, CODE_KINDS),
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

  return issueDevice(row.ownerEmail, label);
}

/**
 * A device credential for this person, now. The step every redemption ends
 * in; also what an install link's pairing does directly (`/api/native/pair`
 * with `join`), there being no code row to redeem. The caller has decided
 * the phone may be theirs — this does not ask.
 */
export async function issueDevice(
  ownerEmail: string,
  label: string | null,
): Promise<{ token: string; ownerEmail: string; expiresAt: Date }> {
  const owner = ownerEmail.trim().toLowerCase();
  const token = mintSecret();
  const expiresAt = new Date(Date.now() + DEVICE_TOKEN_TTL_MS);
  await db.insert(nativeCredentials).values({
    kind: 'device',
    ownerEmail: owner,
    tokenHash: sha256(token),
    label: label?.trim() ? label.trim().slice(0, 60) : 'iPhone',
    expiresAt,
  });
  return { token, ownerEmail: owner, expiresAt };
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

/** A phone's row is stamped at most this often; the uses in between ride on the next stamp. */
export const TOUCH_EVERY_MS = 60_000;
const touched = new Map<string, { at: number; uses: number; said: string }>();

/**
 * How many uses to write for this one, or null to only count it. A phone on
 * the Games lobby asks every five seconds, and each ask used to be an UPDATE
 * of its credential row for a "last used" a person reads in minutes. A phone
 * that says something new about itself (a new build) is written at once.
 */
export function touchDue(id: string, said: string, now = Date.now()): number | null {
  const last = touched.get(id);
  if (last && now - last.at < TOUCH_EVERY_MS && last.said === said) {
    last.uses++;
    return null;
  }
  touched.set(id, { at: now, uses: 0, said });
  return (last?.uses ?? 0) + 1;
}

/** Reset between tests. */
export function resetTouchedForTest(): void {
  touched.clear();
}

/**
 * Stamp last-seen for a device that has just been served — at most once a
 * minute (`touchDue`), so "last used" can be a minute behind and the count
 * arrives in steps.
 *
 * Deliberately fire-and-forget at the call site: this is telemetry for the
 * device list, and a write failing here must never turn a good request into a
 * bad one.
 */
export async function touchDevice(id: string, request?: Request): Promise<void> {
  const t = request ? phoneTelemetry(request.headers) : null;
  const uses = touchDue(id, JSON.stringify(t));
  if (uses === null) return;
  const now = new Date();
  try {
    await db
      .update(nativeCredentials)
      .set({
        lastUsedAt: now,
        useCount: sql`${nativeCredentials.useCount} + ${uses}`,
        // What the phone said about itself, when it said anything: an app from
        // before the headers leaves the last description standing. `appSeenAt`
        // moves only with the build, so it reads as "running 136 since".
        ...(t && {
          appSeenAt:
            t.appBuild === null
              ? undefined
              : sql`case when ${nativeCredentials.appBuild} is distinct from ${t.appBuild} then ${now} else ${nativeCredentials.appSeenAt} end`,
          appVersion: t.appVersion ?? undefined,
          appBuild: t.appBuild ?? undefined,
          appCommit: t.appCommit ?? undefined,
          appChannel: t.appChannel ?? undefined,
          osVersion: t.osVersion ?? undefined,
          deviceModel: t.deviceModel ?? undefined,
          deviceName: t.deviceName ?? undefined,
        }),
      })
      .where(eq(nativeCredentials.id, id));
  } catch (error) {
    // Not written: the next request writes, and carries these uses with it.
    const entry = touched.get(id);
    if (entry) Object.assign(entry, { at: 0, uses: entry.uses + uses });
    throw error;
  }
}

/** The telemetry columns a device list shows, selected the same way everywhere. */
export const DEVICE_TELEMETRY = {
  appVersion: nativeCredentials.appVersion,
  appBuild: nativeCredentials.appBuild,
  appCommit: nativeCredentials.appCommit,
  appChannel: nativeCredentials.appChannel,
  appSeenAt: nativeCredentials.appSeenAt,
  osVersion: nativeCredentials.osVersion,
  deviceModel: nativeCredentials.deviceModel,
  deviceName: nativeCredentials.deviceName,
} as const;

/** Revoke one device. Returns whether a row of this owner's actually moved. */
export async function revokeDevice(ownerEmail: string, id: string): Promise<boolean> {
  const rows = await db
    .update(nativeCredentials)
    .set({ revokedAt: new Date(), apnsToken: null, apnsTokenAt: null, laStartToken: null, laStartTokenAt: null })
    .where(
      and(
        eq(nativeCredentials.id, id),
        eq(nativeCredentials.ownerEmail, ownerEmail.trim().toLowerCase()),
        isNull(nativeCredentials.revokedAt),
      ),
    )
    .returning({ id: nativeCredentials.id });
  if (rows.length) await db.delete(householdJourneyViewer).where(eq(householdJourneyViewer.deviceId, id));
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
      ...DEVICE_TELEMETRY,
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
        and(inArray(nativeCredentials.kind, CODE_KINDS), lt(nativeCredentials.expiresAt, now)),
        and(eq(nativeCredentials.kind, 'device'), lt(nativeCredentials.expiresAt, grace)),
      ),
    )
    .returning({ id: nativeCredentials.id });
  return rows.length;
}
