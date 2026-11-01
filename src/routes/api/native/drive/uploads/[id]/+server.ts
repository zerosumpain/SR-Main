import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { MAX_CHUNK_BYTES, cancelUpload, driveCaller, parseSpace, putChunk, uploadStatus } from '$lib/drive/native-drive';

function spaceOf(url: URL) {
  const space = parseSpace(url.searchParams.get('space'));
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  return space;
}

/** GET /api/native/drive/uploads/:id?space= — `{uploadId, received, size, chunkBytes, expiresAt}`; 404 when it has gone. */
export const GET: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const space = spaceOf(event.url);
  return uploadStatus(await driveCaller(event, identity, role), event.params.id, space);
});

/**
 * PUT /api/native/drive/uploads/:id?space=&offset=N — one piece (≤ 8 MiB) as the
 * raw application/octet-stream body, relayed unchanged. 200 `{received}`; 409
 * `{error, received}` when `offset` is not where Drive is, and the phone resumes
 * from `received`. Rate-limited per device in its own bucket (hooks.server.ts).
 */
export const PUT: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const { request, url } = event;
  const space = spaceOf(url);
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_CHUNK_BYTES) {
    throw error(413, `A piece is at most ${MAX_CHUNK_BYTES / 1024 / 1024} MB.`);
  }
  const caller = await driveCaller(event, identity, role);
  const body = await request.arrayBuffer().catch(() => null);
  if (!body) throw error(400, 'The piece was empty.');
  return putChunk(caller, event.params.id, { space, offset: url.searchParams.get('offset'), bytes: Buffer.from(body) });
});

/** DELETE /api/native/drive/uploads/:id?space= — give up on it; Drive removes what was sent. */
export const DELETE: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const space = spaceOf(event.url);
  return cancelUpload(await driveCaller(event, identity, role), event.params.id, space);
});
