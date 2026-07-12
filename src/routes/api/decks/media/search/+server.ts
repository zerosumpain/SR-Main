// Owner-only (hook-gated like all /api/decks) search across the open-licence
// image providers. Read-only: nothing is stored until /import.

import { json } from '@sveltejs/kit';
import { searchOpenImages } from '$lib/decks/image-sources.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return json({ error: 'q must be at least 2 characters' }, { status: 400 });
  try {
    const results = await searchOpenImages(q);
    return json({ ok: true, results });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'search failed' }, { status: 502 });
  }
};
