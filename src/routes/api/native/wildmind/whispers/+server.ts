import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { WhispersSchema, whispersQuery } from '$lib/wildmind/owner';
import { readOwner } from '$lib/wildmind/owner.server';

/**
 * GET /api/native/wildmind/whispers?limit=1..50 (20) — John's recent whispers
 * to JKai, each pending, heard (with the thought that answered it) or dropped,
 * plus what is still pending, the reserve left for whispers today and whether
 * a model can hear one now. The phone polls this for a minute after sending.
 * Owner only, and owner-only prose (see $lib/wildmind/owner).
 * `{ state: 'offline' }` (200) when the lane is closed or Wildmind is silent.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => readOwner('whispers', whispersQuery(url.searchParams), WhispersSchema));
