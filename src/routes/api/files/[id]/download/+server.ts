import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer } from '$lib/file-store/storage';
import { basename } from 'node:path';

export const GET: RequestHandler = async ({ params, url }) => {
  const [row] = await db.select().from(workflowFiles).where(eq(workflowFiles.id, params.id));
  if (!row) throw error(404, 'file not found');

  let buf: Buffer;
  try {
    buf = await readBuffer(row.diskPath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') throw error(410, 'file content missing on disk');
    throw err;
  }

  const inline = url.searchParams.get('inline') === '1';
  const safeName = basename(row.name).replace(/"/g, '');
  const dispo = `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`;

  // Buffer -> Uint8Array for Response body
  const body = new Uint8Array(buf);
  return new Response(body, {
    headers: {
      'content-type': row.mimeType || 'application/octet-stream',
      'content-length': String(buf.byteLength),
      'content-disposition': dispo,
      'cache-control': 'private, no-store',
    },
  });
};
