// Validated GPX exports for the outdoor route builder.
//
// This file now owns only the GPX-specific part — validating the payload and
// naming the file. The capability link is minted by $lib/file-shares, which
// applies the same expiry and revocation rules to every drive share. The
// token/resolve helpers that used to live here were the immortal-link path and
// have been removed along with the `route_export_token` table they wrote to.

import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { createFileShare } from '$lib/file-shares';
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
    // Minting moved to $lib/file-shares: the token this used to write had a
    // null `expires_at`, which made every route link permanent. Shares from
    // here now expire like any other and appear in the owner's revocation list.
    const share = await createFileShare({
      fileId: file.id,
      createdBy: 'route-export',
      label: `${input.activity} route — ${input.distanceMiles} mi`,
    });
    return { fileId: file.id, name, downloadUrl: share.url };
  } catch (err) {
    await deleteFile(diskPath).catch(() => {});
    throw err;
  }
}

