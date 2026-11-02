import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { latestTvRelease } from '$lib/games/tv-release.server';

/**
 * /tv/version.json — what the sr. tv app checks when it starts:
 * `{ versionCode, versionName, url }` of the newest release. 503 when GitHub
 * cannot say; the app then carries on with what it has.
 */
export const GET: RequestHandler = async () => {
  const release = await latestTvRelease();
  if (!release) return json({ error: 'No release information right now.' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  return json(release, { headers: { 'cache-control': 'public, max-age=300' } });
};
