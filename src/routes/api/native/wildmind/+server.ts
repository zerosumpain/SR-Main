import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { nativeWildmind } from '$lib/landing/wildmind-native.server';

/**
 * GET /api/native/wildmind?have=<terrainVersion> — the valley for the app's
 * own map. Owner only.
 *
 * `{ state, ageSeconds, snapshot, terrain }`: the parsed public snapshot
 * (world tiles, every stat, each person's DOING word) without its terrain,
 * and the raw terrain grids for `snapshot.terrainVersion` beside it, left
 * null when `?have=` already names that version. Always 200 for the owner:
 * an unconfigured or silent Wildmind is `state: 'offline'` with a null
 * snapshot. Answered from the landing page's per-process memo, so the phone
 * adds no request to Wildmind. No cache header: the hook makes every native
 * answer `private, no-store`.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => nativeWildmind(new Date(), url.searchParams.get('have')));
