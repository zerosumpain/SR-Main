import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { deleteFolder, driveCaller, makeFolder } from '$lib/drive/native-drive';
import { parseSpace } from '$lib/drive/app-lane';

/** POST { space, parent, name } — a new, empty folder in one of the caller's two spaces. */
export const POST: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const body = (await event.request.json().catch(() => null)) as { space?: string; parent?: string; name?: string } | null;
  const space = parseSpace(body?.space);
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  const caller = await driveCaller(event, identity, role);
  return json(await makeFolder(caller, space, body?.parent ?? '', body?.name ?? null), { status: 201 });
});

/**
 * DELETE ?space=&folder=a/b — the folder and everything in it, only when every
 * file in it is the caller's to delete (409 otherwise).
 */
export const DELETE: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const space = parseSpace(event.url.searchParams.get('space'));
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  const caller = await driveCaller(event, identity, role);
  return deleteFolder(caller, space, event.url.searchParams.get('folder'));
});
