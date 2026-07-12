// Owner-only: download a provider result and persist a site-served copy —
// decks never hotlink third parties. Returns a ready image-block payload
// (src + alt + attribution caption).

import { json } from '@sveltejs/kit';
import { importImage } from '$lib/decks/image-sources.server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  let body: { imageUrl?: unknown; title?: unknown; creator?: unknown; license?: unknown; source?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.imageUrl !== 'string' || !body.imageUrl) {
    return json({ error: 'imageUrl required' }, { status: 400 });
  }
  try {
    const stored = await importImage({
      imageUrl: body.imageUrl,
      title: typeof body.title === 'string' ? body.title : undefined,
      creator: typeof body.creator === 'string' ? body.creator : null,
      license: typeof body.license === 'string' ? body.license : undefined,
      source: typeof body.source === 'string' ? body.source : undefined,
    });
    return json({ ok: true, ...stored });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'import failed' }, { status: 502 });
  }
};
