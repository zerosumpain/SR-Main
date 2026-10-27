import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import { photoById } from '$lib/family/photos.server';

/**
 * GET /api/native/family/photos/:id — one family member's photo, the JPEG
 * itself (`image/jpeg`, cacheable privately for a day; the list's `version`
 * says when to fetch it again). 404 when they have none. Family only.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const photo = await photoById(event.params.id);
  if (!photo) return json({ error: 'They have no photo.' }, { status: 404 });
  return new Response(new Uint8Array(photo.image), {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'private, max-age=86400',
      etag: `"${photo.version}"`,
    },
  });
});
