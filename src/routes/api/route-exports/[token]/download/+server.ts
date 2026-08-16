import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { basename } from 'node:path';
import { readBuffer } from '$lib/file-store/storage';
import { downloadHeaders } from '$lib/file-serving';
import { resolveLegacyRouteExport } from '$lib/file-shares';

/**
 * LEGACY. Nothing mints tokens for this path any more — new route exports get
 * a `/api/file-shares/<token>/download` link with a real expiry.
 *
 * It stays alive only so links already sent over WhatsApp keep working, and
 * `resolveLegacyRouteExport` now caps those at seven days from creation
 * regardless of the nullable `expires_at` column they were written with. Once
 * the last row ages out, delete this route, the `route_export_token` table and
 * the `/api/route-exports` entry in PUBLIC_PATHS.
 */
export const GET: RequestHandler = async ({ params }) => {
  const row = await resolveLegacyRouteExport(params.token);
  if (!row) throw error(404, 'not found');

  let bytes: Buffer;
  try {
    bytes = await readBuffer(row.diskPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw error(410, 'route export content missing');
    throw err;
  }

  // Anonymous surface, so never inline whatever the type claims to be.
  return new Response(new Uint8Array(bytes), {
    headers: downloadHeaders({
      mimeType: row.mimeType,
      sizeBytes: bytes.byteLength,
      filename: basename(row.name),
      inline: false,
    }),
  });
};
