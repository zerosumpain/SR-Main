// Secure per-project share links. The owner mints an unguessable token that
// grants access to ONE project page even while it is private. Mirrors the
// webdav credential pattern: generate the raw token once, store only its
// sha256, compare by hash. A link is live while it is neither revoked nor
// expired. Server-only (imports the db).

import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { projectShares, type ProjectShare } from '$lib/db/schema';

/** 32 random bytes, base64url → ~43 unguessable URL-safe chars. Shown once. */
export function generateShareToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Per-project cookie name so a validated token survives in-project navigation
 *  (multi-route projects like policy-engine) without leaking across projects. */
export function shareCookieName(key: string): string {
  return 'psh_' + key.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Is this raw token a live share link for `key`? Checks the hash matches an
 * un-revoked, un-expired row for that exact project. On success, bumps
 * lastUsedAt/useCount fire-and-forget so a slow write can't stall the page.
 */
export async function validateProjectShare(key: string, rawToken: string): Promise<boolean> {
  if (!rawToken || rawToken.length < 20) return false;
  const hash = hashShareToken(rawToken);
  const [row] = await db
    .select({ id: projectShares.id, expiresAt: projectShares.expiresAt, revokedAt: projectShares.revokedAt })
    .from(projectShares)
    .where(and(eq(projectShares.tokenHash, hash), eq(projectShares.projectKey, key)))
    .limit(1);
  if (!row) return false;
  if (row.revokedAt) return false;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false;
  // Async last-used bump (do not await — keep the request hot path fast).
  void db
    .update(projectShares)
    .set({ lastUsedAt: new Date(), useCount: sql`${projectShares.useCount} + 1` })
    .where(eq(projectShares.id, row.id))
    .catch(() => {});
  return true;
}

/** Mint a new share link for a project. Returns the RAW token once (never stored). */
export async function createShare(input: {
  projectKey: string;
  createdBy: string;
  label?: string | null;
  expiresAt?: Date | null;
}): Promise<{ id: string; token: string }> {
  const token = generateShareToken();
  const [row] = await db
    .insert(projectShares)
    .values({
      projectKey: input.projectKey,
      tokenHash: hashShareToken(token),
      label: input.label?.trim()?.slice(0, 80) || null,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt ?? null,
    })
    .returning({ id: projectShares.id });
  return { id: row.id, token };
}

export interface PublicShare {
  id: string;
  label: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  useCount: number;
}

/** All links for a project (newest first), never exposing the token hash. */
export async function listShares(projectKey: string): Promise<PublicShare[]> {
  const rows = await db
    .select({
      id: projectShares.id,
      label: projectShares.label,
      createdAt: projectShares.createdAt,
      expiresAt: projectShares.expiresAt,
      revokedAt: projectShares.revokedAt,
      lastUsedAt: projectShares.lastUsedAt,
      useCount: projectShares.useCount,
    })
    .from(projectShares)
    .where(eq(projectShares.projectKey, projectKey))
    .orderBy(desc(projectShares.createdAt));
  return rows;
}

/** Revoke a link (id must belong to projectKey). Returns true if a row changed. */
export async function revokeShare(id: string, projectKey: string): Promise<boolean> {
  const rows = await db
    .update(projectShares)
    .set({ revokedAt: new Date() })
    .where(and(eq(projectShares.id, id), eq(projectShares.projectKey, projectKey)))
    .returning({ id: projectShares.id });
  return rows.length > 0;
}

export type { ProjectShare };
