import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { driveCaller, listSpace, parseSpace } from '$lib/drive/native-drive';

/**
 * GET /api/native/drive?space=mine|shared&folder=a/b — one folder of one of the
 * caller's two spaces (SR-Drive's $lib/drive/app-lane decides): their own, or the family's shared
 * folder. `drive:self` (the owner holds everything). Nothing else of the drive
 * is reachable from the phone — not another member's folder, whatever their
 * level, and the owner's files only from the owner's phone.
 */
export const GET: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const space = parseSpace(event.url.searchParams.get('space'));
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  const caller = await driveCaller(event, identity, role);
  return listSpace(caller, space, event.url.searchParams.get('folder'));
});
