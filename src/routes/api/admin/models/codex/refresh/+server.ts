import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshCodexCatalogue } from '$lib/server/models/codex-discovery';

/** Run the nightly Codex model discovery now. Tests any model the list names
 *  that the site does not know yet, and reports what it found. */
export const POST: RequestHandler = async () => {
  try {
    return json({ ok: true, ...(await refreshCodexCatalogue()) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw error(502, `Failed to refresh the Codex model list: ${msg}`);
  }
};
