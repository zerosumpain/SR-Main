import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isPackId } from '$lib/games/quiz-packs';
import { PackError, addPhoto, photoUrl } from '$lib/games/quiz-packs.server';

/**
 * POST /api/admin/games/quiz-packs/<id>/photos — one photo for a Kelly's Quiz
 * Night pack: multipart `file` (JPEG/PNG/WebP, the page shrinks it first),
 * `caption`, `year`. Owner only (the /api/admin gate).
 */
export const POST: RequestHandler = async ({ params, request }) => {
  if (!isPackId(params.id)) return json({ error: 'That pack is not there.' }, { status: 404 });
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No photo sent.' }, { status: 400 });
  try {
    const photo = await addPhoto(params.id, Buffer.from(await file.arrayBuffer()), file.type, form.get('caption'), form.get('year'));
    return json({ photo: { id: photo.id, caption: photo.caption, year: photo.year, url: photoUrl(params.id, photo.id) } });
  } catch (err) {
    if (err instanceof PackError) return json({ error: err.message }, { status: err.status });
    throw err;
  }
};
