import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshOpenRouterCatalogue } from '$lib/server/models/openrouter-catalogue';

export const POST: RequestHandler = async () => {
  try {
    const result = await refreshOpenRouterCatalogue();
    return json({ ok: true, count: result.count });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw error(502, `Failed to refresh OpenRouter catalogue: ${msg}`);
  }
};
