import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteCanvas } from '$lib/canvas/adapter';

export const DELETE: RequestHandler = async ({ params }) => {
  const ok = await deleteCanvas(params.slug);
  if (!ok) return json({ error: 'Canvas not found' }, { status: 404 });
  return json({ deleted: params.slug });
};
