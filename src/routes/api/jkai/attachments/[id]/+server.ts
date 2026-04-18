import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer, deleteByDiskPath } from '$lib/jkai/media/storage';

export const GET: RequestHandler = async ({ params }) => {
  const [row] = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.id, params.id!)).limit(1);
  if (!row) throw error(404, 'attachment not found');
  let buf: Buffer;
  try {
    buf = await readBuffer(row.diskPath);
  } catch {
    throw error(410, 'attachment file missing on disk');
  }
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': row.mimeType,
      'Content-Length': String(row.sizeBytes),
      'Content-Disposition': `inline; filename="${encodeURIComponent(row.originalName ?? row.id)}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const [row] = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.id, params.id!)).limit(1);
  if (!row) throw error(404, 'attachment not found');
  await deleteByDiskPath(row.diskPath);
  await db.delete(jkaiAttachments).where(eq(jkaiAttachments.id, row.id));
  return json({ deleted: true });
};
