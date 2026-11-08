import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { appleAudience } from '$lib/server/registration';

/**
 * The developer team the iPhone app is signed by. Not a secret: it is in every
 * copy of the app. APPLE_TEAM_ID overrides it (or turns the file off with
 * anything that is not a team id, e.g. `off`).
 */
const DEFAULT_TEAM_ID = 'V74Q4X66B7';

/**
 * /.well-known/apple-app-site-association — what lets these links open the
 * installed app by themselves, as universal links, instead of in Safari:
 *
 *  - an install link (`/app/<code>`), which connects the phone
 *    (`$lib/server/app-links`);
 *  - an sr. tv party's QR (`/games/join/<CODE>`), so a family member with the
 *    app sits down in it as themselves rather than on the web page.
 *
 * The app holds the Associated Domains capability (`applinks:strangeramblings.com`)
 * once its CI has minted a profile with it (SR-AppleApp scripts/asc-app-links.py);
 * a copy without it ignores this file, so the links stay ordinary web pages
 * there. The directory is `[x+2e]well-known`: SvelteKit hides a route whose
 * name starts with a dot.
 */
export const GET: RequestHandler = async () => {
  const team = (env.APPLE_TEAM_ID?.trim() || DEFAULT_TEAM_ID).toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(team)) return new Response('Not found', { status: 404 });
  return json(
    {
      applinks: {
        details: [
          {
            appIDs: [`${team}.${appleAudience()}`],
            components: [
              { '/': '/app/*', comment: 'An install link opens the app and connects the phone.' },
              { '/': '/games/join/*', comment: 'An sr. tv party’s QR opens the app’s join screen.' },
            ],
          },
        ],
      },
    },
    { headers: { 'cache-control': 'public, max-age=3600' } },
  );
};
