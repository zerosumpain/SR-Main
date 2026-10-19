import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { isInstallToken, itmsLink } from '$lib/server/adhoc-install';
import { adhocBuildRunning, latestAdhocBuild } from '$lib/server/adhoc-builds';

/**
 * /install/<token> — the iPhone app for a phone that cannot use TestFlight
 * (`$lib/server/adhoc-install`). Public by design (`/install` in PUBLIC_PATHS):
 * Safari on that phone has no session here, and the token is the permission.
 * A wrong token 404s like any missing page.
 */
export const load: PageServerLoad = async ({ params, url, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  if (!isInstallToken(params.token, env.AUTH_SECRET)) throw error(404, 'Not found');

  const [build, running] = await Promise.all([
    latestAdhocBuild().catch((err) => {
      console.error('[install] could not read the ad-hoc build:', err);
      return undefined;
    }),
    adhocBuildRunning().catch(() => false),
  ]);
  const manifest = `${url.origin}/install/${params.token}/manifest.plist`;
  return {
    // undefined: GitHub could not be read; null: nothing built yet.
    build: build === undefined ? undefined : build && { version: build.version, builtAt: build.builtAt, devices: build.devices },
    running,
    enrolled: url.searchParams.get('enrolled'),
    install: build ? itmsLink(manifest) : null,
  };
};
