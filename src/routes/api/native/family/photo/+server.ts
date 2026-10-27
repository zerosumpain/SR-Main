import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import { familyId } from '$lib/family/roster.server';
import { parsePhotoUpload } from '$lib/family/photos';
import { deletePhoto, putPhoto } from '$lib/family/photos.server';

/**
 * PUT /api/native/family/photo — `{ jpeg: "<base64>" }`: the caller's photo
 * of themselves, in place of their initials circle on every family phone. A
 * JPEG of at most 300 KB (400 with a sentence otherwise); it replaces any
 * earlier one. Answers `{ id, version }` — the caller's id as the steps board
 * and messages know them.
 *
 * DELETE — back to initials. Answers `{ ok: true }` whether or not there was
 * one.
 *
 * Family only, as /api/native/family/messages. Both are writes, so a "View as"
 * look is refused by the gate.
 */
export const PUT: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const input = parsePhotoUpload(await event.request.json().catch(() => null));
  if ('error' in input) return json({ error: input.error }, { status: 400 });
  const version = await putPhoto(caller.email, input.bytes);
  return { id: familyId(caller.email), version };
});

export const DELETE: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  await deletePhoto(caller.email);
  return { ok: true };
});
