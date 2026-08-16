import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { basename } from 'node:path';
import { readBuffer } from '$lib/file-store/storage';
import { resolveRouteExport } from '$lib/route-exports';

/** Public only through a high-entropy, file-scoped route-export capability. */
export const GET: RequestHandler = async ({ params }) => {
  const row = await resolveRouteExport(params.token);
  if (!row) throw error(404, 'route export not found');

  let bytes: Buffer;
  try {
    bytes = await readBuffer(row.diskPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw error(410, 'route export content missing');
    throw err;
  }

  const filename = basename(row.name).replace(/"/g, '');
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': row.mimeType,
      'content-length': String(bytes.byteLength),
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  });
};
