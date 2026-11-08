import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { driveCaller, parseSpace, startUpload } from '$lib/drive/native-drive';

/**
 * POST /api/native/drive/uploads?space=mine|shared — open a resumable upload
 * for a file above the single-shot limit (videos, big pictures). JSON
 * `{folder, filename, type, size, sha256, takenAt?}`. 201 the session
 * `{uploadId, chunkBytes, received, size, expiresAt}`; 200 `{file, duplicate:true}`
 * when these bytes are already in the space. Relayed to SR-Drive, which decides.
 */
export const POST: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const space = parseSpace(event.url.searchParams.get('space'));
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw error(400, 'Send the file’s details as JSON.');
  return startUpload(await driveCaller(event, identity, role), {
    space,
    folder: body.folder,
    filename: body.filename,
    type: body.type,
    size: body.size,
    sha256: body.sha256,
    takenAt: body.takenAt,
  });
});
