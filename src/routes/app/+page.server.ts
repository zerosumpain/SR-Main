import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { APP_COOKIE, buildIncludes, installToken, itmsLink, joinDisplayName, readAppCookie } from '$lib/server/adhoc-install';
import { adhocBuildRunning, latestAdhocBuild } from '$lib/github/adhoc-builds';

/**
 * /app — the one address for the family's iPhone app (`$lib/server/adhoc-install`).
 * Public (`/app` in PUBLIC_PATHS). It offers the install only to a Safari that
 * a join link has been opened in (the signed `sr_app` cookie); anyone else is
 * told to ask for their link, and sees nothing else.
 */
export const load: PageServerLoad = async ({ cookies, url, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  const slug = readAppCookie(cookies.get(APP_COOKIE), env.AUTH_SECRET);
  if (!slug || !env.AUTH_SECRET) return { known: false as const };

  const [build, running] = await Promise.all([
    latestAdhocBuild().catch((err) => {
      console.error('[app] could not read the ad-hoc build:', err);
      return undefined;
    }),
    adhocBuildRunning().catch(() => false),
  ]);
  const manifest = `${url.origin}/install/${installToken(env.AUTH_SECRET)}/manifest.plist`;
  return {
    known: true as const,
    name: joinDisplayName(slug),
    added: url.searchParams.get('added'),
    // undefined: GitHub could not be read; null: nothing built yet.
    build: build === undefined ? undefined : build && { version: build.version, builtAt: build.builtAt },
    included: build ? buildIncludes(build.devices, slug) : false,
    running,
    install: build ? itmsLink(manifest) : null,
  };
};
