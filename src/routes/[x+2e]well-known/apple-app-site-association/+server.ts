import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { appleAudience } from '$lib/server/registration';

/**
 * /.well-known/apple-app-site-association — what lets an install link
 * (`https://strangeramblings.com/app/<code>`) open the installed app by
 * itself, as a universal link, instead of through Safari and the "Open SR"
 * button (`$lib/server/app-links`).
 *
 * It needs the app's team id, and the app needs the Associated Domains
 * capability (`applinks:strangeramblings.com`) in its entitlements and in
 * re-minted profiles — a step on the developer account, not in a repo. Until
 * APPLE_TEAM_ID is set this is a 404, so nothing claims a capability the app
 * does not hold. The directory is `[x+2e]well-known`: SvelteKit hides a
 * route whose name starts with a dot.
 */
export const GET: RequestHandler = async () => {
  const team = env.APPLE_TEAM_ID?.trim();
  if (!team || !/^[A-Z0-9]{10}$/.test(team)) return new Response('Not found', { status: 404 });
  return json(
    { applinks: { details: [{ appIDs: [`${team}.${appleAudience()}`], components: [{ '/': '/app/*', comment: 'An install link opens the app and connects the phone.' }] }] } },
    { headers: { 'cache-control': 'public, max-age=3600' } },
  );
};
