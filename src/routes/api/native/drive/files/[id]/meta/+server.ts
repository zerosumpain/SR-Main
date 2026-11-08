import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { driveCaller, fileMeta, parseSpace } from '$lib/drive/native-drive';

/**
 * GET /api/native/drive/files/:id/meta?space= — the phone's Info screen: the
 * file, plus (owner only) jkai's analysis, the entity-extraction state and the
 * email it came from, sender by name only. A member gets the file and nulls.
 */
export const GET: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const space = parseSpace(event.url.searchParams.get('space'));
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  return fileMeta(await driveCaller(event, identity, role), event.params.id, space);
});
