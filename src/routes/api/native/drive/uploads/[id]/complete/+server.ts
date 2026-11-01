import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { completeUpload, driveCaller, parseSpace } from '$lib/drive/native-drive';

/**
 * POST /api/native/drive/uploads/:id/complete?space= — Drive checks the size and
 * sha256 and stores the file. 201 `{file, duplicate:false}`, or 200
 * `{file, duplicate:true}` (already there, or a repeat complete): the only two
 * answers that count as stored for "move from phone". 409 `{error, received}`
 * when pieces are missing; 422 when the bytes did not match the hash.
 */
export const POST: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const space = parseSpace(event.url.searchParams.get('space'));
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  return completeUpload(await driveCaller(event, identity, role), event.params.id, space);
});
