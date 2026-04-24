/**
 * GET    /api/scraper/script?profile=<p>  → { profile, code, meta } or { profile, code: null }
 * DELETE /api/scraper/script?profile=<p>  → { cleared: boolean }
 *
 * Drives the StealthScrapePanel's "Script status" section: see whether
 * an LLM-authored scrape script exists for the given profile, view it,
 * or delete it to force a re-author on the next run.
 */
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { readScript, deleteScript } from '$lib/workflows/scraper/script-store';

function resolveProfile(url: URL): string {
  const p = url.searchParams.get('profile');
  if (!p) throw error(400, 'profile query param required');
  return p;
}

export const GET: RequestHandler = async ({ url }) => {
  const profile = resolveProfile(url);
  const r = await readScript(profile);
  if (!r) return json({ profile, code: null, meta: null });
  return json({ profile, code: r.code, meta: r.meta });
};

export const DELETE: RequestHandler = async ({ url }) => {
  const profile = resolveProfile(url);
  const cleared = await deleteScript(profile);
  return json({ profile, cleared });
};
