import type { PageServerLoad } from './$types';
import { gamesCaller } from '$lib/games/site-access.server';
import { leaderboardFor } from '$lib/games/api.server';
import { isWindow } from '$lib/games/results';

/**
 * /games/leaderboard — the family's boards for a window picked by `?window=`
 * (day | week | all; anything else is this week). Server-rendered: switching
 * window is a link, so the page works before (and without) hydration.
 */
export const load: PageServerLoad = async (event) => {
  const caller = await gamesCaller(event);
  const asked = event.url.searchParams.get('window');
  const board = await leaderboardFor(caller, isWindow(asked) ? asked : 'week');
  return { meId: board.me.id, board };
};
