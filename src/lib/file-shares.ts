// Capability links for drive files.
//
// One token authorises exactly one file, for a bounded time, and can be killed
// by hand. The raw token is returned once at mint time and never persisted —
// only its SHA-256 — so a database dump yields no working URLs.
//
// Two callers, two different limits:
//   - the OWNER, from /drive, may share any file;
//   - an AGENT (jkai, a workflow tool) may share only files an agent created.
//     `assertAgentMayShare` enforces that against an allow-list of uploader
//     tags. Human uploads are recorded under an email address and can never
//     match it, so no prompt-injected model can turn a bank statement into a
//     public URL by guessing a file id.
//
// Generalised from $lib/route-exports (the GPX-only original). What changed and
// why is documented on `fileShareTokens` in $lib/db/schema.

import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { fileShareTokens, routeExportTokens, workflowFiles } from '$lib/db/schema';

/** How long a newly minted link lives. Renewable by minting another. */
export const SHARE_TTL_DAYS = 7;

/**
 * The maximum age of a token in the LEGACY `route_export_token` table.
 *
 * That table's `expires_at` is nullable and `createRouteExport` never set it,
 * so every row it holds is an anonymous URL that works forever. Rather than
 * migrate data, the same seven-day policy is applied here at read time: a
 * legacy token stops resolving once it is this old, whatever the column says.
 */
const LEGACY_MAX_AGE_DAYS = 7;

/**
 * Uploader tags that count as "created by an agent" and are therefore
 * shareable without the owner in the loop.
 *
 * An explicit allow-list, not a `!includes('@')` test on the email format:
 * this fails closed for anything unrecognised, including a null uploader from
 * the WebDAV mount (src/routes/dav writes `uploadedBy: null` on some paths).
 */
// `route-export` is the only tag any drive file carries today (the other 56
// rows are the owner's two email addresses). `jkai` is listed ahead of need so
// a future drive-writing tool has a tag to stamp; note that convert/extract
// INHERIT the parent's uploadedBy, so a derivative of a human upload stays an
// email address and stays unshareable.
const AGENT_UPLOADERS = new Set(['route-export', 'jkai']);

export function isAgentCreated(uploadedBy: string | null | undefined): boolean {
  return uploadedBy != null && AGENT_UPLOADERS.has(uploadedBy);
}

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function shareDownloadUrl(token: string): string {
  const baseUrl = (process.env.PUBLIC_SITE_URL || 'https://strangeramblings.com').replace(/\/+$/, '');
  return `${baseUrl}/api/file-shares/${encodeURIComponent(token)}/download`;
}

export interface CreateShareInput {
  fileId: string;
  /** Owner email, or an agent tag. Recorded verbatim in the share list. */
  createdBy: string;
  label?: string | null;
  ttlDays?: number;
}

export interface CreatedShare {
  tokenId: string;
  fileId: string;
  name: string;
  url: string;
  expiresAt: Date;
}

/**
 * Refuse an agent-initiated share of a file a human uploaded.
 *
 * Throws rather than returning false: every caller must treat this as fatal,
 * and a boolean invites being logged and ignored.
 */
export async function assertAgentMayShare(fileId: string): Promise<void> {
  const [row] = await db
    .select({ uploadedBy: workflowFiles.uploadedBy, name: workflowFiles.name })
    .from(workflowFiles)
    .where(eq(workflowFiles.id, fileId))
    .limit(1);
  if (!row) throw new Error('file not found');
  if (!isAgentCreated(row.uploadedBy)) {
    throw new Error(
      `"${row.name}" was not created by an agent, so it cannot be shared automatically. ` +
        'Ask the owner to share it from /drive if they want a link.',
    );
  }
}

export async function createFileShare(input: CreateShareInput): Promise<CreatedShare> {
  const ttlDays = input.ttlDays ?? SHARE_TTL_DAYS;
  if (!Number.isFinite(ttlDays) || ttlDays <= 0 || ttlDays > 90) {
    throw new Error('share lifetime must be between 1 and 90 days');
  }
  const [file] = await db
    .select({ id: workflowFiles.id, name: workflowFiles.name })
    .from(workflowFiles)
    .where(eq(workflowFiles.id, input.fileId))
    .limit(1);
  if (!file) throw new Error('file not found');

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(fileShareTokens)
    .values({
      fileId: file.id,
      tokenHash: hashShareToken(token),
      label: input.label?.slice(0, 120) ?? null,
      createdBy: input.createdBy,
      expiresAt,
    })
    .returning({ id: fileShareTokens.id });

  return { tokenId: row.id, fileId: file.id, name: file.name, url: shareDownloadUrl(token), expiresAt };
}

export interface ResolvedShare {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  diskPath: string;
}

/**
 * Trade a raw token for the one file it authorises, or null.
 *
 * Null covers unknown, revoked, expired and malformed alike — the caller turns
 * all of them into the same 404, so probing cannot distinguish "never existed"
 * from "expired yesterday".
 */
export async function resolveFileShare(token: string): Promise<ResolvedShare | null> {
  if (!token || token.length < 32 || token.length > 128) return null;
  const tokenHash = hashShareToken(token);

  const [row] = await db
    .select({
      tokenId: fileShareTokens.id,
      expiresAt: fileShareTokens.expiresAt,
      revokedAt: fileShareTokens.revokedAt,
      id: workflowFiles.id,
      name: workflowFiles.name,
      mimeType: workflowFiles.mimeType,
      sizeBytes: workflowFiles.sizeBytes,
      diskPath: workflowFiles.diskPath,
    })
    .from(fileShareTokens)
    .innerJoin(workflowFiles, eq(fileShareTokens.fileId, workflowFiles.id))
    .where(eq(fileShareTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row) return null;
  if (row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;

  void db
    .update(fileShareTokens)
    .set({ lastUsedAt: new Date(), useCount: sql`${fileShareTokens.useCount} + 1` })
    .where(eq(fileShareTokens.id, row.tokenId))
    .catch(() => {});

  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    diskPath: row.diskPath,
  };
}

export interface ShareListRow {
  id: string;
  fileId: string;
  fileName: string;
  label: string | null;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  useCount: number;
  /** Derived so the UI never has to re-implement the expiry rule. */
  active: boolean;
}

/** Every share, newest first. Never returns a token or a hash. */
export async function listFileShares(includeInactive = true): Promise<ShareListRow[]> {
  const rows = await db
    .select({
      id: fileShareTokens.id,
      fileId: fileShareTokens.fileId,
      fileName: workflowFiles.name,
      label: fileShareTokens.label,
      createdBy: fileShareTokens.createdBy,
      createdAt: fileShareTokens.createdAt,
      expiresAt: fileShareTokens.expiresAt,
      revokedAt: fileShareTokens.revokedAt,
      lastUsedAt: fileShareTokens.lastUsedAt,
      useCount: fileShareTokens.useCount,
    })
    .from(fileShareTokens)
    .innerJoin(workflowFiles, eq(fileShareTokens.fileId, workflowFiles.id))
    .where(includeInactive ? undefined : isNull(fileShareTokens.revokedAt))
    .orderBy(desc(fileShareTokens.createdAt));

  const now = Date.now();
  return rows.map((r) => ({ ...r, active: !r.revokedAt && r.expiresAt.getTime() > now }));
}

/** Kill a link immediately. Idempotent — revoking a dead share is not an error. */
export async function revokeFileShare(id: string): Promise<boolean> {
  const revoked = await db
    .update(fileShareTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(fileShareTokens.id, id), isNull(fileShareTokens.revokedAt)))
    .returning({ id: fileShareTokens.id });
  return revoked.length > 0;
}

/**
 * Legacy read path for `/api/route-exports/<token>/download`.
 *
 * Kept only so links already sent over WhatsApp keep working until they age
 * out. Nothing mints into this table any more; once the last row passes
 * LEGACY_MAX_AGE_DAYS the endpoint and the table can both go.
 */
export async function resolveLegacyRouteExport(token: string): Promise<ResolvedShare | null> {
  if (!token || token.length < 32 || token.length > 128) return null;
  const [row] = await db
    .select({
      tokenId: routeExportTokens.id,
      createdAt: routeExportTokens.createdAt,
      expiresAt: routeExportTokens.expiresAt,
      revokedAt: routeExportTokens.revokedAt,
      id: workflowFiles.id,
      name: workflowFiles.name,
      mimeType: workflowFiles.mimeType,
      sizeBytes: workflowFiles.sizeBytes,
      diskPath: workflowFiles.diskPath,
    })
    .from(routeExportTokens)
    .innerJoin(workflowFiles, eq(routeExportTokens.fileId, workflowFiles.id))
    .where(eq(routeExportTokens.tokenHash, hashShareToken(token)))
    .limit(1);

  if (!row || row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  if (isLegacyTokenTooOld(row.createdAt)) return null;

  void db
    .update(routeExportTokens)
    .set({ lastUsedAt: new Date(), useCount: sql`${routeExportTokens.useCount} + 1` })
    .where(eq(routeExportTokens.id, row.tokenId))
    .catch(() => {});

  return {
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    diskPath: row.diskPath,
  };
}

export function isLegacyTokenTooOld(createdAt: Date, now: number = Date.now()): boolean {
  return now - createdAt.getTime() > LEGACY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}
