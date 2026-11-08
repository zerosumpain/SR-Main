import type { RequestHandler } from './$types';
import { isPackId, isPhotoId } from '$lib/games/quiz-packs';
import { signedPhoto } from '$lib/games/quiz-packs.server';

/**
 * GET /api/games/photos/<pack>/<photo>?e=&s= — one Kelly's Quiz Night photo,
 * for the TV board and the phones in a room playing its pack. PUBLIC
 * (`/api/games/photos` in PUBLIC_PATHS): the signature is the permission —
 * HMAC over the pack, the photo and an expiry twelve hours out, written into
 * the room's questions when it loaded the pack. Forged, expired and gone all
 * 404 alike, and nothing is cached by a shared cache.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  if (!isPackId(params.pack) || !isPhotoId(params.photo)) return new Response('Not found', { status: 404 });
  const found = await signedPhoto(params.pack, params.photo, url.searchParams.get('e'), url.searchParams.get('s')).catch(() => null);
  if (!found) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      'content-type': found.mime,
      'cache-control': 'private, max-age=3600',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
    },
  });
};
