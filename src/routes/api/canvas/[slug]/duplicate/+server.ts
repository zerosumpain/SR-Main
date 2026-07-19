import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { duplicateCanvas } from '$lib/canvas/adapter.server';

/** One-click canvas duplicate — copies nodes + edges under a fresh slug.
 *  The copy has no schedule (a cloned cron must not silently run twice). */
export const POST: RequestHandler = async ({ params }) => {
  const copy = await duplicateCanvas(params.slug);
  if (!copy) return json({ error: 'Canvas not found' }, { status: 404 });
  return json(copy, { status: 201 });
};
