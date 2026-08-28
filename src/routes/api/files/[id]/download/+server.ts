import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { readBuffer } from '$lib/file-store/storage';
import { downloadHeaders } from '$lib/file-serving';
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

  // `inline` is a REQUEST, not a decision: downloadHeaders downgrades it to an
  // attachment unless the stored type is one that cannot carry script. The
  // stored type is the uploader's `file.type` (see api/files/upload), so it is
  // not trustworthy input.
  const body = new Uint8Array(buf);
  return new Response(body, {
    headers: downloadHeaders({
      mimeType: row.mimeType,
      sizeBytes: buf.byteLength,
      filename: basename(row.name),
      inline: url.searchParams.get('inline') === '1',
    }),
  });
};
