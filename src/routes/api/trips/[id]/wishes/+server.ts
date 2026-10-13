import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownerTrip, readJson, replanned } from '$lib/trips/api.server';
import { parseWishInput, type WishInput } from '$lib/trips/intake';
import { addWishes } from '$lib/trips/store.server';

/**
 * POST /api/trips/:id/wishes — one wish, or `{ wishes: [...] }` (the confirmed
 * drafts from the free-text reader). New wishes have no place until the
 * research scan finds one; they are listed as unplanned until then.
 */
export const POST: RequestHandler = async (event) => {
  const { trip } = await ownerTrip(event);
  const body = await readJson(event);
  const list = body && typeof body === 'object' && Array.isArray((body as { wishes?: unknown }).wishes) ? (body as { wishes: unknown[] }).wishes : [body];
  if (list.length > 40) return json({ error: 'At most 40 wishes at a time.' }, { status: 400 });
  const clean: WishInput[] = [];
  for (const item of list) {
    const parsed = parseWishInput(item);
    if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
    clean.push(parsed.value);
  }
  const wishes = await addWishes(trip.id, clean);
  return replanned(trip, { wishes }, 201);
};
