import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import { stepsBoard } from '$lib/family/steps.server';

/**
 * GET /api/native/family/steps — today's family steps board (London day).
 *
 * Read from the rows the `family-steps` heartbeat stores every 15 minutes;
 * nothing here asks the pilot, so a pull-to-refresh is cheap and a slow app
 * server never holds the screen. Ranks 1..n, a tie shares its rank; `me`
 * marks the caller. Family only: the owner, `family:circle` or `family:admin`.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const { window, board, checkedAt, yesterday } = await stepsBoard();
  return {
    day: window.day,
    updatedAt: checkedAt?.toISOString() ?? null,
    people: board.map((p) => ({
      id: p.id,
      name: p.name,
      steps: p.steps,
      rank: p.rank,
      me: p.email === caller.email,
      updatedAt: p.reachedAt?.toISOString() ?? null,
    })),
    yesterday,
  };
});
