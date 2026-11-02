import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { photoPeople, requirePhotoOwner } from '$lib/drive/native-photos';

/**
 * GET /api/native/drive/photos/people?filter=all|named|unnamed&q=&limit= —
 * the faces in the owner's photos for the search's person picker, each with
 * its native face crop. Hidden faces are left out. Owner only.
 */
export const GET: RequestHandler = withNativeAccess('drive', async (event, _identity, role) => {
  requirePhotoOwner(role);
  return photoPeople(event.url.searchParams);
});
