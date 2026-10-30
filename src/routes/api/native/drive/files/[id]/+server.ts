import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { contentDisposition, deleteOne, driveCaller, readDriveFile } from '$lib/drive/native-drive';

/**
 * GET /api/native/drive/files/:id — the bytes of a file in one of the caller's
 * two spaces. Anything else, including a file that exists in someone else's
 * folder, is the same 404 as no file at all.
 *
 * Always an attachment under a sandbox CSP and nosniff: the stored type is
 * whatever the uploader claimed, and these bytes must never run as a page on
 * the site's origin if a browser is ever pointed here.
 */
export const GET: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const caller = await driveCaller(event, identity, role);
  const { row, bytes } = await readDriveFile(caller, event.params.id);
  const filename = row.name.slice(row.name.lastIndexOf('/') + 1);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': row.mimeType || 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': contentDisposition(filename),
      'Content-Security-Policy': 'sandbox',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=300',
    },
  });
});

/** DELETE — in your own space, anything; in the shared folder, only what you added (the owner: anything). */
export const DELETE: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const caller = await driveCaller(event, identity, role);
  await deleteOne(caller, event.params.id);
  return { ok: true };
});
