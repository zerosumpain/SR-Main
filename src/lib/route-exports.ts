// Durable, capability-scoped GPX exports for the outdoor route builder.
// A token only authorises the one exported track it was minted for.

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { routeExportTokens, workflowFiles } from '$lib/db/schema';
import { deleteFile, newDiskPath, saveBuffer } from '$lib/file-store/storage';

export const GPX_MIME_TYPE = 'application/gpx+xml';
const ROUTE_PREFIX = 'drive/routes/';

export type RouteActivity = 'running' | 'mountain-biking';

export interface RouteExportInput {
  gpx: string;
  basename: string;
  activity: RouteActivity;
  distanceMiles: number;
  date?: string;
}

export function routeExportName(input: Pick<RouteExportInput, 'basename'>): string {
  const basename = input.basename.trim();
  if (!basename || basename.length > 120 || basename.includes('/') || basename.includes('\\') || basename === '.' || basename === '..') {
    throw new Error('basename must be a safe filename without path separators');
  }
  if (!/^[a-z0-9][a-z0-9._-]*\.gpx$/i.test(basename)) {
    throw new Error('basename must be a safe .gpx filename');
  }
  return `${ROUTE_PREFIX}${basename}`;
}

export function validateRouteExport(input: RouteExportInput): void {
  routeExportName(input);
  if (input.activity !== 'running' && input.activity !== 'mountain-biking') {
    throw new Error('activity must be running or mountain-biking');
  }
  if (!Number.isFinite(input.distanceMiles) || input.distanceMiles <= 0) {
    throw new Error('distanceMiles must be a positive number');
  }
  if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  if (!/^\s*<\?xml\b[\s\S]*?<gpx\b[^>]*\bversion=["']1\.1["'][^>]*>[\s\S]*<\/gpx>\s*$/i.test(input.gpx)) {
    throw new Error('gpx must be a complete GPX 1.1 XML document');
  }
}

export function hashRouteExportToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createRouteExportToken(): string {
  return randomBytes(32).toString('base64url');
}

export function routeDownloadUrl(token: string): string {
  const baseUrl = (process.env.PUBLIC_SITE_URL || 'https://strangeramblings.com').replace(/\/+$/, '');
  return `${baseUrl}/api/route-exports/${encodeURIComponent(token)}/download`;
}

/** Save a validated GPX and mint a bearer capability scoped to that file only. */
export async function createRouteExport(input: RouteExportInput): Promise<{
  fileId: string;
  name: string;
  downloadUrl: string;
}> {
  validateRouteExport(input);
  const name = routeExportName(input);
  const content = Buffer.from(input.gpx, 'utf8');
  const [existing] = await db.select({ id: workflowFiles.id }).from(workflowFiles).where(eq(workflowFiles.name, name)).limit(1);
  if (existing) throw new Error(`a route export already exists at ${name}`);

  const diskPath = newDiskPath(name);
  await saveBuffer(diskPath, content);
  try {
    const [file] = await db.insert(workflowFiles).values({
      name,
      description: `${input.activity} route — ${input.distanceMiles} mi`,
      mimeType: GPX_MIME_TYPE,
      sizeBytes: content.byteLength,
      diskPath,
      permissions: { read: true, write: false, append: false, delete: false },
      uploadedBy: 'route-export',
    }).returning({ id: workflowFiles.id });
    const token = createRouteExportToken();
    await db.insert(routeExportTokens).values({ fileId: file.id, tokenHash: hashRouteExportToken(token) });
    return { fileId: file.id, name, downloadUrl: routeDownloadUrl(token) };
  } catch (err) {
    await deleteFile(diskPath).catch(() => {});
    throw err;
  }
}

/** Resolve a token without exposing any other drive record. */
export async function resolveRouteExport(token: string) {
  if (!token || token.length < 20) return null;
  const [row] = await db
    .select({
      tokenId: routeExportTokens.id,
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
    .where(and(eq(routeExportTokens.tokenHash, hashRouteExportToken(token)), eq(workflowFiles.mimeType, GPX_MIME_TYPE)))
    .limit(1);
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) return null;
  void db.update(routeExportTokens).set({ lastUsedAt: new Date(), useCount: sql`${routeExportTokens.useCount} + 1` })
    .where(eq(routeExportTokens.id, row.tokenId)).catch(() => {});
  return row;
}
