import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { buildQuery, installManifest, isInstallToken, requestedBuild } from '$lib/server/adhoc-install';
import { releasedAdhocBuild } from '$lib/github/app-release';
import { adhocBuildByRun } from '$lib/github/adhoc-builds';

/**
 * What iOS reads before it installs: where the app is, and which app it is.
 * The released copy, or — `?build=N&key=…`, a build the owner sent one phone
 * (`$lib/github/app-device-push`) — that build, and the IPA link says so too.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  if (!isInstallToken(params.token, env.AUTH_SECRET)) throw error(404, 'Not found');
  const run = requestedBuild(url.searchParams, env.AUTH_SECRET);
  if (run === false) throw error(404, 'Not found');
  const build = await (run === null ? releasedAdhocBuild() : adhocBuildByRun(run)).catch(() => null);
  if (!build) throw error(404, 'No build yet');
  const ipa = `${url.origin}/install/${params.token}/app.ipa${run === null ? '' : `?${buildQuery(env.AUTH_SECRET, run)}`}`;
  return new Response(installManifest(ipa, build.bundleId, build.version), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
  });
};
