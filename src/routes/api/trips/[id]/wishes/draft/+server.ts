import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { draftWishesFromText } from '$lib/trips/research.server';

/**
 * POST /api/trips/:id/wishes/draft — `{ text }`: "what do you want to do?"
 * read into draft wishes by one cheap model call. Nothing is saved: the page
 * shows the drafts and the person confirms which to add.
 */
export const POST: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  const body = (await readJson(event)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (text.length < 3) return json({ error: 'Write a little about what you want to do.' }, { status: 400 });
  try {
    return json({ wishes: await draftWishesFromText(text, trip) });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 503 });
  }
};
