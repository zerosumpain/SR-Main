import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { playerFor } from '$lib/games/players.server';
import { leaderboard } from '$lib/games/results.server';
import { isWindow } from '$lib/games/results';

/**
 * GET /api/native/games/leaderboard?window=day|week|all — the family's games
 * boards for today, this week (Monday on, Europe/London) or all time: overall
 * wins, then per game each person's best score, wins and games played.
 * `me` is the caller's player id, so the phone can pick out its own rows.
 * Names only — never an email. `window` defaults to `week`.
 */
export const GET: RequestHandler = withNativeAccess('games', async (event, identity) => {
  const raw = event.url.searchParams.get('window') ?? 'week';
  if (!isWindow(raw)) error(400, 'Pick day, week or all.');
  const me = await playerFor(identity.ownerEmail);
  return { me: { id: me.id }, ...(await leaderboard(raw)) };
});
