// Research share links, stored like decks and file shares: the raw token is
// returned once and only its sha256 is kept (`research_session.share_token_hash`).
//
// Links issued before 2026-10-02 were stored in plain text in `share_token`.
// They keep working: a lookup that misses on the hash falls back to the legacy
// column once, and on a match moves the token into the hash column and nulls
// the plain text, so each legacy link is upgraded the first time it is used.
// scripts/migrations/2026-10-02-research-share-token-hash.sql upgrades the rest
// in bulk; this module is correct with or without it having run. Server-only.

import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';

type SessionRow = typeof researchSessions.$inferSelect;

/** 32 random bytes, base64url → ~43 unguessable URL-safe chars. Shown once. */
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Legacy tokens were UUIDs (36 chars); new ones are ~43. Anything short is not a link. */
const MIN_TOKEN_LENGTH = 20;

/** The session a share link opens, or null. Upgrades a legacy plaintext link on first use. */
export async function findSharedSession(rawToken: string): Promise<SessionRow | null> {
  if (typeof rawToken !== 'string' || rawToken.length < MIN_TOKEN_LENGTH) return null;
  const hash = hashShareToken(rawToken);

  const [hashed] = await db.select().from(researchSessions).where(eq(researchSessions.shareTokenHash, hash)).limit(1);
  if (hashed) return hashed;

  const [legacy] = await db.select().from(researchSessions).where(eq(researchSessions.shareToken, rawToken)).limit(1);
  if (!legacy) return null;
  await upgradeLegacy(legacy.id, rawToken);
  return { ...legacy, shareToken: null, shareTokenHash: hash };
}

/**
 * Move a legacy plaintext token into the hash column. Guarded on the plaintext
 * still being the stored value, so a concurrent revoke or re-issue wins.
 */
async function upgradeLegacy(sessionId: string, rawToken: string): Promise<void> {
  await db
    .update(researchSessions)
    .set({ shareTokenHash: hashShareToken(rawToken), shareToken: null })
    .where(and(eq(researchSessions.id, sessionId), eq(researchSessions.shareToken, rawToken)));
}

export type IssueShareResult =
  /** The raw token, shown to the caller this once. */
  | { status: 'issued'; token: string }
  /** A hashed link already exists; its token cannot be shown again. Pass `rotate` to replace it. */
  | { status: 'exists' };

/**
 * Issue the session's share link.
 *
 * - A legacy plaintext link is returned as-is (so the link already handed out
 *   keeps working) and upgraded to its hash in the same step.
 * - A hashed link cannot be shown again: without `rotate` the caller is told it
 *   exists; with `rotate` a new token replaces it and the old link stops working.
 * - Otherwise a new token is minted.
 */
export async function issueShare(
  session: Pick<SessionRow, 'id' | 'shareToken' | 'shareTokenHash'>,
  opts: { rotate?: boolean } = {},
): Promise<IssueShareResult> {
  if (session.shareToken && !opts.rotate) {
    await upgradeLegacy(session.id, session.shareToken);
    return { status: 'issued', token: session.shareToken };
  }
  if (session.shareTokenHash && !opts.rotate) return { status: 'exists' };

  const token = generateShareToken();
  await db
    .update(researchSessions)
    .set({ shareTokenHash: hashShareToken(token), shareToken: null })
    .where(eq(researchSessions.id, session.id));
  return { status: 'issued', token };
}

/** Revoke the session's link, legacy or hashed. */
export async function revokeShare(sessionId: string): Promise<void> {
  await db
    .update(researchSessions)
    .set({ shareTokenHash: null, shareToken: null })
    .where(eq(researchSessions.id, sessionId));
}

/** Whether the session has a live link — for the UI, which never sees a token it did not just mint. */
export function isShared(session: Pick<SessionRow, 'shareToken' | 'shareTokenHash'>): boolean {
  return !!(session.shareTokenHash || session.shareToken);
}
