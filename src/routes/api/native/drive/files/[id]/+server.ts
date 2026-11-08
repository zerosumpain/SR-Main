import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { deleteOne, download, driveCaller, parseSpace, renameOrMove } from '$lib/drive/native-drive';

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

/**
 * PATCH `{space, name?, folder?}` — rename and/or move within the same space.
 * 409 when the name is taken there; 403 for a shared file someone else added.
 */
export const PATCH: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const body = (await event.request.json().catch(() => null)) as { space?: unknown; name?: unknown; folder?: unknown } | null;
  const space = parseSpace(typeof body?.space === 'string' ? body.space : null);
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  return renameOrMove(await driveCaller(event, identity, role), event.params.id, {
    space,
    name: typeof body?.name === 'string' ? body.name : null,
    folder: typeof body?.folder === 'string' ? body.folder : null,
  });
});
