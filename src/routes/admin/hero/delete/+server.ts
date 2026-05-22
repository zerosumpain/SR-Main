import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { heroTitles } from '$lib/db/schema';
import { invalidateHeroTitlesCache } from '$lib/landing/hero-titles-service';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid body');
  const b = body as Record<string, unknown>;

  if (b.all === true) {
    await db.delete(heroTitles);
  } else {
    const id = Math.round(Number(b.id));
    if (!Number.isInteger(id)) throw error(400, 'Invalid id');
    await db.delete(heroTitles).where(eq(heroTitles.id, id));
  }
  invalidateHeroTitlesCache();
  return json({ ok: true });
};
