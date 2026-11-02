import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { photoImage, requirePhotoOwner } from '$lib/drive/native-photos';

/**
 * GET /api/native/drive/photos/face/<uuid> — one person's face crop for the
 * photo search's person picker, through SR-Drive's owner-only proxy. Owner only.
 */
export const GET: RequestHandler = withNativeAccess('drive', async (event, _identity, role) => {
  requirePhotoOwner(role);
  return photoImage('face', event.params.id, null);
});
