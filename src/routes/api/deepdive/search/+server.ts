import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { globalSearch } from '$lib/deepdive/cross-session';

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return json({ entities: [], facts: [] });
  }

  const results = await globalSearch(q);
  return json(results);
};
