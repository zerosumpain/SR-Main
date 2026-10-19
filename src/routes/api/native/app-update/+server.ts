import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { identifyDevice } from '$lib/server/native-auth';
import { installToken, itmsLink } from '$lib/server/adhoc-install';
import { latestAdhocBuild } from '$lib/github/adhoc-builds';

/**
 * GET /api/native/app-update — the newest ad-hoc copy of the app, for a copy
 * installed from /app to offer itself an update (`$lib/server/adhoc-install`).
 * TestFlight and App Store copies never ask: they update themselves.
 *
 * Any phone holding a site credential may ask — it already has the app — and
 * nobody else, because the answer carries the install link. `{ build: null }`
 * when there is no copy, or GitHub cannot be read: no prompt is the safe
 * answer to either.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  if (!(await identifyDevice(request))) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!env.AUTH_SECRET) return json({ build: null });
  const build = await latestAdhocBuild().catch((err) => {
    console.error('[app-update] could not read the ad-hoc build:', err);
    return null;
  });
  if (!build) return json({ build: null });
  return json({
    build: {
      version: build.version,
      build: build.build,
      commit: build.commit,
      builtAt: build.builtAt,
      install: itmsLink(`${url.origin}/install/${installToken(env.AUTH_SECRET)}/manifest.plist`),
    },
  });
};
