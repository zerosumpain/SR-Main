import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { saveHeroTitles } from '$lib/landing/hero-titles-service';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid body');
  const b = body as Record<string, unknown>;

  const mode = b.mode === 'append' ? 'append' : 'replace';
  const rows = Array.isArray(b.rows) ? b.rows : [];
  if (rows.length === 0) throw error(400, 'No rows to save');

  try {
    const count = await saveHeroTitles(rows, mode);
    return json({ ok: true, count });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'Save failed');
  }
};
