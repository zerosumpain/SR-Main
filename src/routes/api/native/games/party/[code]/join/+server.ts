import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { asHttp } from '$lib/games/rooms.server';
import { playerFor } from '$lib/games/players.server';
import { joinFamily } from '$lib/games/party.server';

/**
 * POST /api/native/games/party/<CODE>/join — the app scanned a TV's QR
 * (`sr://games/join/<CODE>`): the member sits down as themselves. The party
 * answers with its `roomId` once a game runs; the app follows that room with
 * its own stream (`/api/native/games/<roomId>/stream`) and native controls.
 * `seat` is the party page's own cookie value, for the app's web view.
 */
export const POST: RequestHandler = withNativeAccess('games', async (event, identity) => {
  const me = await playerFor(identity.ownerEmail);
  const { party, memberId, seat } = asHttp(() => joinFamily(event.params.code, { id: me.id, name: me.name }));
  // The seat signs the app's web view of the party page in as this member (the host's controls live there).
  return { party, me: { id: memberId }, seat };
});
