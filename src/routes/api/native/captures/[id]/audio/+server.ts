import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { getCapture, recorderSpace } from '$lib/captures/store.server';
import { attachMedia, CaptureMediaError, isRefusal } from '$lib/captures/service.server';
import { readCaptureMedia } from '$lib/captures/media.server';

/**
 * PUT /api/native/captures/:id/audio — the audio as the RAW body (never
 * multipart: SvelteKit refuses a cross-site form POST before a handler runs),
 * with its content-type. 204. The file is sniffed; the declared type is only a
 * hint. A retry replaces the earlier upload.
 *
 * GET — the bytes, bearer-authenticated, for the phone's player / image view.
 */
export const PUT: RequestHandler = withDevice(async ({ params, request }) => {
  const buf = await request.arrayBuffer().catch(() => null);
  if (!buf || buf.byteLength === 0) return json({ error: 'The upload was empty.' }, { status: 400 });
  try {
    const refused = await attachMedia(recorderSpace(), params.id, 'audio', Buffer.from(buf), request.headers.get('content-type'));
    if (isRefusal(refused)) return json({ error: refused.error }, { status: refused.status });
  } catch (err) {
    // "Too large" and "not audio" are things the phone can act on; withDevice
    // would flatten them into "Something went wrong".
    if (err instanceof CaptureMediaError) return json({ error: err.message }, { status: err.status });
    throw err;
  }
  return new Response(null, { status: 204 });
});

export const GET: RequestHandler = withDevice(async ({ params }) => {
  const c = await getCapture(params.id, recorderSpace());
  if (!c || !c.audioUploadId) return json({ error: 'No such audio.' }, { status: 404 });
  let media;
  try {
    media = await readCaptureMedia(c.audioUploadId);
  } catch {
    return json({ error: 'That file is no longer on the server.' }, { status: 410 });
  }
  if (!media) return json({ error: 'No such audio.' }, { status: 404 });
  return new Response(new Uint8Array(media.buf), {
    status: 200,
    headers: {
      'Content-Type': media.mimeType,
      'Content-Length': String(media.sizeBytes),
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
