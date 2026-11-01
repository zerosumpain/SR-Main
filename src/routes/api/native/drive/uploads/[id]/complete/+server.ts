import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { completeUpload, driveCaller, parseSpace } from '$lib/drive/native-drive';

/**
 * POST /api/native/drive/uploads/:id/complete?space= — Drive checks the size,
 * then hashes and stores the file in the background, waiting up to 20 s.
 * 201 `{file, duplicate:false}`, or 200 `{file, duplicate:true}` (already there,
 * or a repeat complete); 202 `{status:"storing", received, size}` while it is
 * still storing — poll GET uploads/:id, or complete again. 409
 * `{error, received}` when pieces are missing.
 */
export const POST: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const space = parseSpace(event.url.searchParams.get('space'));
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  return completeUpload(await driveCaller(event, identity, role), event.params.id, space);
});
