import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { identifyDevice, touchDevice } from '$lib/server/native-auth';
import { installToken, itmsLink } from '$lib/server/adhoc-install';
import { releasedAdhocBuild } from '$lib/github/app-release';

/**
 * GET /api/native/app-update — the RELEASED ad-hoc copy of the app (the owner
 * chooses it on /admin/access/app, `$lib/github/app-release`), for a copy
 * installed from /app to offer itself an update (`$lib/server/adhoc-install`).
 * TestFlight and App Store copies never ask: they update themselves.
 *
 * Any phone holding a site credential may ask — it already has the app — and
 * nobody else, because the answer carries the install link. `{ build: null }`
 * when there is no copy, or GitHub cannot be read: no prompt is the safe
 * answer to either.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  const identity = await identifyDevice(request);
  if (!identity) return json({ error: 'Unauthorized' }, { status: 401 });
  // The hourly check is the one call every copy makes, so it is where a
  // phone's build and last-seen are most worth recording (native-telemetry).
  void touchDevice(identity.id, request).catch(() => {});
  if (!env.AUTH_SECRET) return json({ build: null });
  const build = await releasedAdhocBuild().catch((err) => {
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
