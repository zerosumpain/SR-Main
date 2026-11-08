import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { cleanPreviewVersion, driveCaller, parsePreviewSize, preview } from '$lib/drive/native-drive';

/**
 * GET /api/native/drive/files/:id/preview?size=thumb|view[&v=…] — a JPEG of a
 * picture in one of the caller's two spaces, for the app's Drive grid (thumb,
 * 360 px) and viewer (view, 2048 px), streamed from SR-Drive. Drive decides
 * who may see it, exactly as the download; its ETag and private cache headers
 * pass through, and If-None-Match comes back a 304.
 */
export const GET: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const size = parsePreviewSize(event.url.searchParams.get('size') ?? 'thumb');
  if (!size) throw error(400, 'Ask for size=thumb or size=view.');
  return preview(await driveCaller(event, identity, role), event.params.id, size, {
    ifNoneMatch: event.request.headers.get('if-none-match'),
    version: cleanPreviewVersion(event.url.searchParams.get('v')),
  });
});
