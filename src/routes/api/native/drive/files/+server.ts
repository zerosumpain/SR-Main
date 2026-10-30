import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { MAX_UPLOAD_BYTES, driveCaller, uploadFile } from '$lib/drive/native-drive';
import { parseSpace } from '$lib/drive/app-lane';

/**
 * POST /api/native/drive/files?space=&folder=&filename= — one file, as the raw
 * request body (not multipart: SvelteKit refuses a form POST without a
 * matching Origin, which a phone never sends; see /api/native/chat/attachments).
 * Into the caller's own space or the shared folder, nowhere else.
 */
export const POST: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const { request, url } = event;
  const space = parseSpace(url.searchParams.get('space'));
  if (!space) throw error(400, 'Ask for space=mine or space=shared.');
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    throw error(413, `That file is over ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  }
  const caller = await driveCaller(event, identity, role);
  const body = await request.arrayBuffer().catch(() => null);
  if (!body) throw error(400, 'The upload was empty.');
  const file = await uploadFile(caller, {
    space,
    folder: url.searchParams.get('folder'),
    filename: url.searchParams.get('filename'),
    mimeType: (request.headers.get('content-type') ?? 'application/octet-stream').slice(0, 120),
    bytes: Buffer.from(body),
  });
  return json({ file }, { status: 201 });
});
