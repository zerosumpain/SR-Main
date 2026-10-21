import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { isInstallToken, requestedBuild } from '$lib/server/adhoc-install';
import { adhocBuildByRun, adhocIpa } from '$lib/github/adhoc-builds';
import { releasedAdhocBuild } from '$lib/github/app-release';

/**
 * The app itself, streamed from the private draft release on GitHub
 * (`$lib/github/adhoc-builds`) — it has no public URL of its own. The
 * released copy, or the one build a signed `?build=N&key=…` names.
 */
export const GET: RequestHandler = async ({ params, url }) => {
  if (!isInstallToken(params.token, env.AUTH_SECRET)) throw error(404, 'Not found');
  const run = requestedBuild(url.searchParams, env.AUTH_SECRET);
  if (run === false) throw error(404, 'Not found');
  const build = await (run === null ? releasedAdhocBuild() : adhocBuildByRun(run)).catch(() => null);
  if (!build) throw error(404, 'No build yet');
  const upstream = await adhocIpa(build).catch((err) => {
    console.error('[install] could not fetch the IPA:', err);
    return null;
  });
  if (!upstream?.body) throw error(502, 'The app could not be fetched');
  const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' };
  const length = upstream.headers.get('content-length');
  if (length) headers['content-length'] = length;
  return new Response(upstream.body, { headers });
};
