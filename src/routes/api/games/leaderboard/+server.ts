import type { RequestHandler } from './$types';
import { withGamesSession } from '$lib/games/site-access.server';
import { leaderboardFor } from '$lib/games/api.server';

/**
 * GET /api/games/leaderboard?window=day|week|all — the web's door onto the
 * family games boards: the same `leaderboardFor` the phone's
 * `/api/native/games/leaderboard` answers with, for a browser session holding
 * `games:self`. `window` defaults to `week`.
 */
export const GET: RequestHandler = withGamesSession(async (event, caller) =>
  leaderboardFor(caller, event.url.searchParams.get('window')),
);
