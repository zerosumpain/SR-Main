import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createCanvas, listCanvases } from '$lib/canvas/adapter.server';
import { startBuildFromPrompt } from '$lib/workflows/build-from-prompt.server';

export const GET: RequestHandler = async () => {
  const canvases = await listCanvases();
  return json({ canvases });
};

/**
 * POST /api/canvas
 *   { slug, title }      → a blank canvas at that slug.
 *   { prompt, title? }   → "Describe it": the canvas is created now and built by
 *                          the model in the background — the SAME module the
 *                          iPhone's POST /api/native/workflows uses, so the two
 *                          cannot drift. → 201 { slug, building: true }
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 4000) : '';
  if (prompt) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const { slug } = await startBuildFromPrompt({ prompt, title: title || null });
    return json({ slug, building: true }, { status: 201 });
  }
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
