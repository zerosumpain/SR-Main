import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { installManifest, isInstallToken } from '$lib/server/adhoc-install';
import { latestAdhocBuild } from '$lib/server/adhoc-builds';

/** What iOS reads before it installs: where the app is, and which app it is. */
export const GET: RequestHandler = async ({ params, url }) => {
  if (!isInstallToken(params.token, env.AUTH_SECRET)) throw error(404, 'Not found');
  const build = await latestAdhocBuild().catch(() => null);
  if (!build) throw error(404, 'No build yet');
  return new Response(installManifest(`${url.origin}/install/${params.token}/app.ipa`, build.bundleId, build.version), {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-store' },
  });
};
