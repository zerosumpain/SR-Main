import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { parseHold } from '$lib/home/presence/location-hold';
import { clearHold, getHold, setHold } from '$lib/home/presence/location-hold.server';

/**
 * /api/native/family/hold — the owner's location hold, from Settings in his
 * app. While one is on, everyone else in the family sees him at the held
 * point, fresh and still (`$lib/home/presence/location-hold`), and his phone
 * sends no fixes.
 *
 * GET → `{ hold }` (null when none, or once it has run out).
 * PUT `{ lat, lon, label, until }` → `{ hold }`; `until` within a week.
 * DELETE → `{ hold: null }`.
 *
 * OWNER ONLY, on `withDevice`: a member's phone 403s, and so does the owner's
 * phone viewing as a member — a hold is not something anyone else may see
 * exists, let alone set.
 */
export const GET: RequestHandler = withDevice(async () => ({ hold: await getHold() }));

export const PUT: RequestHandler = withDevice(async ({ request }) => {
  const input = parseHold(await request.json().catch(() => null), new Date());
  if ('error' in input) return json({ error: input.error }, { status: 400 });
  await setHold(input.hold);
  return { hold: input.hold };
});

export const DELETE: RequestHandler = withDevice(async () => {
  await clearHold();
  return { hold: null };
});
