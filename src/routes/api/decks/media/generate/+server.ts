// Owner-only: generate an image via the free pollinations.ai service and
// persist a site-served copy. Cold generations can take tens of seconds —
// the client shows progress; the fetch itself times out at 90s server-side.

import { json } from '@sveltejs/kit';
import { generateImage } from '$lib/decks/image-sources.server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  let body: { prompt?: unknown; width?: unknown; height?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length < 3) return json({ error: 'prompt must be at least 3 characters' }, { status: 400 });
  if (prompt.length > 600) return json({ error: 'prompt too long (max 600 chars)' }, { status: 400 });
  const dim = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 256 && v <= 2048 ? v : fallback;
  try {
    const stored = await generateImage(prompt, dim(body.width, 1600), dim(body.height, 900));
    return json({ ok: true, ...stored });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'generation failed' }, { status: 502 });
  }
};
