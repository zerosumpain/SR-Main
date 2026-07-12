// Secure per-deck share links — the deck twin of $lib/projects/shares.ts.
// The owner mints an unguessable token that grants access to ONE deck while it
// is private. Generate the raw token once, store only its sha256, compare by
// hash. A link is live while it is neither revoked nor expired. Server-only.

import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { deckShares, type DeckShare } from '$lib/db/schema';

/** 32 random bytes, base64url → ~43 unguessable URL-safe chars. Shown once. */
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Per-deck cookie name so a validated token survives navigation within one
 *  deck without leaking across decks. Keyed by slug (stable, URL-visible). */
export function shareCookieName(slug: string): string {
  return 'dsh_' + slug.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Is this raw token a live share link for `deckId`? Checks the hash matches an
 * un-revoked, un-expired row for that exact deck. On success, bumps
 * lastUsedAt/useCount fire-and-forget so a slow write can't stall the page.
 */
export async function validateDeckShare(deckId: string, rawToken: string): Promise<boolean> {
  if (!rawToken || rawToken.length < 20) return false;
  const hash = hashShareToken(rawToken);
  const [row] = await db
    .select({ id: deckShares.id, expiresAt: deckShares.expiresAt, revokedAt: deckShares.revokedAt })
    .from(deckShares)
    .where(and(eq(deckShares.tokenHash, hash), eq(deckShares.deckId, deckId)))
    .limit(1);
  if (!row) return false;
  if (row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
  // Async last-used bump (do not await — keep the request hot path fast).
  void db
    .update(deckShares)
    .set({ lastUsedAt: new Date(), useCount: sql`${deckShares.useCount} + 1` })
    .where(eq(deckShares.id, row.id))
    .catch(() => {});
  return true;
}

/** Mint a new share link for a deck. Returns the RAW token once (never stored). */
export async function createShare(input: {
  deckId: string;
  createdBy: string;
  label?: string | null;
  expiresAt?: Date | null;
}): Promise<{ id: string; token: string }> {
  const token = generateShareToken();
  const [row] = await db
    .insert(deckShares)
    .values({
      deckId: input.deckId,
      tokenHash: hashShareToken(token),
      label: input.label?.trim()?.slice(0, 80) || null,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: deckShares.id });
  return { id: row.id, token };
}

export interface PublicDeckShare {
  id: string;
  label: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  useCount: number;
  /** Distinct slides this link's viewers reached (from slidesReached keys). */
  slidesReached: number;
}

/** All links for a deck (newest first), never exposing the token hash. */
export async function listShares(deckId: string): Promise<PublicDeckShare[]> {
  const rows = await db
    .select({
      id: deckShares.id,
      label: deckShares.label,
      createdAt: deckShares.createdAt,
      expiresAt: deckShares.expiresAt,
      revokedAt: deckShares.revokedAt,
      lastUsedAt: deckShares.lastUsedAt,
      useCount: deckShares.useCount,
      slidesReachedRaw: deckShares.slidesReached,
    })
    .from(deckShares)
    .where(eq(deckShares.deckId, deckId))
    .orderBy(desc(deckShares.createdAt));
  return rows.map(({ slidesReachedRaw, ...row }) => ({
    ...row,
    slidesReached: slidesReachedRaw ? Object.keys(slidesReachedRaw as Record<string, number>).length : 0,
  }));
}

/** Revoke a link (id must belong to deckId). Returns true if a row changed. */
export async function revokeShare(id: string, deckId: string): Promise<boolean> {
  const rows = await db
    .update(deckShares)
    .set({ revokedAt: new Date() })
    .where(and(eq(deckShares.id, id), eq(deckShares.deckId, deckId)))
    .returning({ id: deckShares.id });
  return rows.length > 0;
}

export type { DeckShare };
