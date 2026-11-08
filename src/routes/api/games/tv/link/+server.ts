import type { RequestHandler } from './$types';
import { linkStream } from '$lib/games/tv-devices.server';

/**
 * GET /api/games/tv/link — a TV waiting to be linked (`$lib/games/tv-devices.server`).
 * PUBLIC (`/api/games/tv` in PUBLIC_PATHS): the stream shows a code until the
 * owner approves it at /admin/games/tvs, then hands over the TV's token.
 */
export const GET: RequestHandler = () => linkStream();
