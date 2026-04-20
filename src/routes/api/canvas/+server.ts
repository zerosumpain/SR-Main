import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createCanvas, listCanvases } from '$lib/canvas/adapter';

export const GET: RequestHandler = async () => {
  const canvases = await listCanvases();
  return json({ canvases });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const slug = typeof body.slug === 'string' ? body.slug : '';
  const title = typeof body.title === 'string' ? body.title : '';
  if (!slug) return json({ error: 'slug required' }, { status: 400 });
  try {
    const created = await createCanvas(slug, title);
    return json(created, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('already exists') ? 409 : 400;
    return json({ error: message }, { status });
  }
};
