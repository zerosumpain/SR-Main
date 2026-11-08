import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import { familyPhotos } from '$lib/family/photos.server';

/**
 * GET /api/native/family/photos — everyone in the family who has set a photo
 * of themselves: `{ photos: [{ id, subject, version }] }`. `id` is the id the
 * steps board and messages know them by (the owner answers to the id of each
 * of their addresses, so there may be one entry per address); `subject` is
 * their household trail subject, or null. The phone fetches the bytes from
 * `/photos/:id` and re-fetches only when `version` changes.
 *
 * Family only, as /api/native/family/messages: the owner's phone or a Family
 * Circle / Family Admin member's. Everyone else 403s.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  return { photos: await familyPhotos() };
});
