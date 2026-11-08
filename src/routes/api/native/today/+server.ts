import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { loadToday } from '$lib/today/today.server';
import { NATIVE_TODAY_SECTIONS } from '$lib/today/today';

/**
 * GET /api/native/today — the first screen, in one request.
 *
 * Five separate calls would be the tidy decomposition and the wrong one. This
 * is the screen the app opens on, over whatever the phone is connected to, and
 * five round trips on a train is five chances to show a spinner. They are
 * settled in parallel and each failure degrades its own card rather than the
 * screen: Health being down leaves three cards and a note, not an error page.
 *
 * Everything here is a SUMMARY. The figure, the count, the headline. Tapping
 * any of it goes to the tab that owns it, which fetches properly. A first
 * screen that tried to be every screen would be slower than all of them.
 *
 * The loader is shared (`$lib/today`) with the jkai desk and the chat tools;
 * this route asks for exactly the six sections the app has always decoded,
 * and `today-route.test.ts` pins the shape.
 */
export const GET: RequestHandler = withDevice(async ({ url }, identity) =>
  loadToday({ ownerKey: identity.ownerEmail, fresh: url.searchParams.get('fresh') === '1', sections: NATIVE_TODAY_SECTIONS }),
);
