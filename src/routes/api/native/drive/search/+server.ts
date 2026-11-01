import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { driveCaller, parseSpace, searchSpace } from '$lib/drive/native-drive';

/**
 * GET /api/native/drive/search?space=&q= — file names across the whole space
 * (up to 100), for everyone; `semantic` contents hits for the owner in his own
 * space only.
 */
export const GET: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const space = parseSpace(event.url.searchParams.get('space'));
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  return searchSpace(await driveCaller(event, identity, role), space, event.url.searchParams.get('q'));
});
