import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { photoImage, requirePhotoOwner } from '$lib/drive/native-photos';

/**
 * GET /api/native/drive/photos/thumb/<uuid>?size=thumb|preview — one photo's
 * thumbnail (or its larger preview) as bytes, through SR-Drive's owner-only
 * Immich proxy, with Drive's cache lifetime. Owner only.
 */
export const GET: RequestHandler = withNativeAccess('drive', async (event, _identity, role) => {
  requirePhotoOwner(role);
  return photoImage('thumb', event.params.id, event.url.searchParams.get('size'));
});
