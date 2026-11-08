import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { InventionsSchema } from '$lib/wildmind/owner';
import { readOwner } from '$lib/wildmind/owner.server';

/**
 * GET /api/native/wildmind/inventions — everything invented in this valley,
 * newest first (with the description, recipe summary, rationale and referee
 * notes, never the 3D `visual`), and the recently refused ideas. Owner only,
 * and owner-only prose (see $lib/wildmind/owner). `{ state: 'offline' }` (200)
 * when the lane is closed or Wildmind does not answer.
 */
export const GET: RequestHandler = withDevice(async () => readOwner('inventions', new URLSearchParams(), InventionsSchema));
