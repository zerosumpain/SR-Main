import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { deleteOne, download, driveCaller } from '$lib/drive/native-drive';

/**
 * GET /api/native/drive/files/:id — the bytes of a file in one of the caller's
 * two spaces, relayed from SR-Drive (which decides; anything outside them is
 * the same 404 as no file). Always an attachment under a sandbox CSP.
 */
export const GET: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  return download(await driveCaller(event, identity, role), event.params.id);
});

/** DELETE — in your own space, anything; in the shared folder, only what you added (the owner: anything). */
export const DELETE: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  await deleteOne(await driveCaller(event, identity, role), event.params.id);
  return { ok: true };
});
