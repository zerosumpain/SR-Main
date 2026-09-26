import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer, deleteByDiskPath } from '$lib/jkai/media/storage';
import { chatAccess } from '$lib/jkai/chat-access.server';
import { canRead, canWrite } from '$lib/server/area-scope';
import { servingHeaders } from '$lib/jkai/media/serve';

// A file is its uploader's: one the reader may not see is a 404, exactly like
// one that does not exist.
export const GET: RequestHandler = async (event) => {
  const { params } = event;
  const access = await chatAccess(event);
  const [row] = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.id, params.id!)).limit(1);
  if (!row || !canRead(row.principalId, access)) throw error(404, 'attachment not found');
  let buf: Buffer;
  try {
    buf = await readBuffer(row.diskPath);
  } catch {
    throw error(410, 'attachment file missing on disk');
  }
  const serve = servingHeaders(row.mimeType, row.kind);
  const headers: Record<string, string> = {
    'Content-Type': serve.type,
    'Content-Length': String(row.sizeBytes),
    'Content-Disposition': `${serve.disposition}; filename="${encodeURIComponent(row.originalName ?? row.id)}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
  };
  // A download is never rendered; if something opens it anyway, it runs nothing.
  if (serve.disposition === 'attachment') headers['Content-Security-Policy'] = "sandbox; default-src 'none'";
  return new Response(new Uint8Array(buf), { status: 200, headers });
};

export const DELETE: RequestHandler = async (event) => {
  const { params } = event;
  const access = await chatAccess(event);
  const [row] = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.id, params.id!)).limit(1);
  if (!row || !canRead(row.principalId, access)) throw error(404, 'attachment not found');
  if (!canWrite(row.principalId, access)) throw error(403, 'Forbidden');
  await deleteByDiskPath(row.diskPath);
  await db.delete(jkaiAttachments).where(eq(jkaiAttachments.id, row.id));
  return json({ deleted: true });
};
