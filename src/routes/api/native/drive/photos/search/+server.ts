import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { requirePhotoOwner, searchPhotos } from '$lib/drive/native-photos';

/**
 * GET /api/native/drive/photos/search?person=&text=&ocr=&place=&from=&to=&type=&limit=&page=
 * — the owner's photos that match, from SR-Drive's Immich (paged), plus on
 * the first page of a "what's in it" search the images in Drive's file index
 * that Immich does not have. `{connected, reason?, total, page, hasMore,
 * results}`. Owner only: anyone else gets 403 before Drive is asked.
 */
export const GET: RequestHandler = withNativeAccess('drive', async (event, _identity, role) => {
  requirePhotoOwner(role);
  return searchPhotos(event.url.searchParams);
});
