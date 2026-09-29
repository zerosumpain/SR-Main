import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { leaderboardFor } from '$lib/games/api.server';

/**
 * GET /api/native/games/leaderboard?window=day|week|all — the family's games
 * boards for today, this week (Monday on, Europe/London) or all time. The
 * body is `leaderboardFor` in `$lib/games/api.server`, shared with the web
 * door (`/api/games/leaderboard`). `window` defaults to `week`.
 */
export const GET: RequestHandler = withNativeAccess('games', async (event, identity, role) =>
  leaderboardFor({ email: identity.ownerEmail, role }, event.url.searchParams.get('window')),
);
