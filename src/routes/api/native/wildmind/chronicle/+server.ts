import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { ChronicleSchema, chronicleId } from '$lib/wildmind/owner';
import { readOwner } from '$lib/wildmind/owner.server';

/**
 * GET /api/native/wildmind/chronicle?id=main|companion — one person's life so
 * far: who they are, where they are now (goal, mood, last thought, ambitions,
 * values, attitudes, people), their timeline newest first and their diary.
 * Owner only, and owner-only prose (see $lib/wildmind/owner).
 *
 * `{ state: 'offline' }` (200) when the lane is closed or silent; 400
 * `{ error: 'bad-id' }` for anyone but main or companion; 404
 * `{ error: 'no-such-person' }` when the valley has nobody by that id.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  const id = chronicleId(url.searchParams);
  if (!id) return json({ error: 'bad-id' }, { status: 400 });
  const read = await readOwner('chronicle', new URLSearchParams({ id }), ChronicleSchema);
  if (read.state === 'not-found') return json({ error: 'no-such-person' }, { status: 404 });
  return read;
});
