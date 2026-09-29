import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { roomStream } from '$lib/games/api.server';

/**
 * GET /api/native/games/[id]/stream — the room as SSE, one
 * `{"type":"room","room":…}` frame now and on every change; a
 * `{"type":"gone"}` frame and the end of the stream when the room is dropped.
 * The stream itself is `roomStream` in `$lib/games/api.server`, shared with
 * the web door.
 */
export const GET: RequestHandler = withNativeAccess('games', async (event, identity, role) =>
  roomStream({ email: identity.ownerEmail, role }, event.params.id),
);
