// Secure per-project share links. The owner mints an unguessable token that
// grants access to ONE project page even while it is private. Generate the raw
// token once, store only its sha256, compare by hash — the same pattern the
// file-share capabilities. A link is live while it is neither revoked nor
// expired. Server-only (imports the db).

import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { projectShares, type ProjectShare } from '$lib/db/schema';
import { hashSharePassword } from './share-password';
import { visitStats, type ShareVisit, type ShareVisitStats } from './share-visitor';
import { recordShareVisit, shareVisitStats } from './share-visits';

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

/** A live link, as the access decision needs it: whether it asks for a password, and which. */
export interface LiveShare {
  passwordHash: string | null;
}

let visitWarnedAt = 0;

/**
 * Is this raw token a live share link for `key`? Checks the hash matches an
 * un-revoked, un-expired row for that exact project, and answers with the
 * link's password verifier (null when it asks for none), or null for no live
 * link. On success, bumps lastUsedAt/useCount and records the visitor
 * (`visit`, from the gateway's session call) fire-and-forget so a slow write
 * can't stall the page.
 */
export async function validateProjectShare(
  key: string,
  rawToken: string,
  visit: ShareVisit | null = null,
): Promise<LiveShare | null> {
  if (!rawToken || rawToken.length < 20) return null;
  const hash = hashShareToken(rawToken);
  const [row] = await db
    .select({
      id: projectShares.id,
      expiresAt: projectShares.expiresAt,
      revokedAt: projectShares.revokedAt,
      passwordHash: projectShares.passwordHash,
    })
    .from(projectShares)
    .where(and(eq(projectShares.tokenHash, hash), eq(projectShares.projectKey, key)))
    .limit(1);
  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  // Async last-used bump (do not await — keep the request hot path fast).
  // useCount counts page opens: a gateway that says which requests open a page
  // is counted on those alone; an older one, and Main's own pages, on every
  // request as before.
  const opened = visit?.open !== false;
  void db
    .update(projectShares)
    .set(opened ? { lastUsedAt: new Date(), useCount: sql`${projectShares.useCount} + 1` } : { lastUsedAt: new Date() })
    .where(eq(projectShares.id, row.id))
    .catch(() => {});
  if (visit?.visitorHash) {
    void recordShareVisit(row.id, visit).catch((err: Error) => {
      // Once a minute at most: a missing runtime grant would fail every request.
      if (Date.now() - visitWarnedAt < 60_000) return;
      visitWarnedAt = Date.now();
      console.warn(`[shares] visitor not recorded: ${err.message}`);
    });
  }
  return { passwordHash: row.passwordHash ?? null };
}

/**
 * Mint a new share link for a project. Returns the RAW token once (never
 * stored). With a password, the row keeps only its scrypt verifier; the caller
 * has already checked the project's app asks for one and the length.
 */
export async function createShare(input: {
  projectKey: string;
  createdBy: string;
  label?: string | null;
  expiresAt?: Date | null;
  password?: string | null;
}): Promise<{ id: string; token: string }> {
  const token = generateShareToken();
  const passwordHash = input.password ? await hashSharePassword(input.password) : null;
  const [row] = await db
    .insert(projectShares)
    .values({
      projectKey: input.projectKey,
      tokenHash: hashShareToken(token),
      label: input.label?.trim()?.slice(0, 80) || null,
      createdBy: input.createdBy,
      expiresAt: input.expiresAt ?? null,
      passwordHash,
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
  /** The link asks for a password. The verifier itself never leaves the server. */
  hasPassword: boolean;
}

/** All links for a project (newest first), never exposing the token hash or password verifier. */
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
      hasPassword: sql<boolean>`${projectShares.passwordHash} is not null`,
    })
    .from(projectShares)
    .where(eq(projectShares.projectKey, projectKey))
    .orderBy(desc(projectShares.createdAt));
  return rows.map((r) => ({ ...r, hasPassword: r.hasPassword === true }));
}

/** A link as the owner's Share panel lists it: the row, and who has opened it. */
export type SharedLink = PublicShare & ShareVisitStats;

/**
 * All links for a project with their visitor numbers, in three queries however
 * many links. The numbers failing (a missing grant) still lists the links, each
 * with its own use count, so the owner can always revoke one.
 */
export async function listSharesWithVisits(projectKey: string): Promise<SharedLink[]> {
  const shares = await listShares(projectKey);
  const stats = await shareVisitStats(projectKey, shares).catch((err: Error) => {
    console.warn(`[shares] visitor numbers unavailable: ${err.message}`);
    return new Map<string, ShareVisitStats>();
  });
  return shares.map((s) => ({ ...s, ...(stats.get(s.id) ?? visitStats(s.useCount, undefined, [])) }));
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
