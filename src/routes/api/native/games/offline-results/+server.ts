import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { jsonBody } from '$lib/games/api.server';
import { recordOfflineResults } from '$lib/games/offline-results.server';

/**
 * POST /api/native/games/offline-results — games played with no internet,
 * sent later by the phone (SRAppleApp `OfflineResultStore`): `{ results: [
 * { id, game: 'offline:<slug>', source: 'offline', title, mode, finishedAt,
 * players, bots, rank, score, won, detail, opponents } ] }` in batches of 25.
 *
 * Answers `{ recorded: [id], rejected: [id] }`; the phone settles both and
 * sends anything in neither again. Each result is filed as ONE `game_results`
 * row for the caller (room `offline-<id>`, round 1), so a retry lands once.
 * Games access, as the other games routes; View as is refused by the gate
 * (look-only), so an owner previewing a child cannot file games as them.
 */
export const POST: RequestHandler = withNativeAccess('games', async (event, identity, role) => {
  const body = await jsonBody(event.request);
  if (!body || !Array.isArray(body.results)) {
    return json({ error: 'Send { results: [...] }.' }, { status: 400 });
  }
  return recordOfflineResults({ email: identity.ownerEmail, role }, body.results);
});
