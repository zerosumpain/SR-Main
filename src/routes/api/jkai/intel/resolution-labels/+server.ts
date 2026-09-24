import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { isOwnerScope } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';
/**
 * Owner-only export of reviewed pre-decision snapshots for offline evaluation.
 * The labels carry no space and span every space's pairs, so the owner-only
 * claim is enforced here rather than left to the hook.
 */
export const GET: RequestHandler = async (event) => {
  if (!isOwnerScope(await resolveRequestScope(event))) return json({ error: 'owner only' }, { status: 403 });
  const labels = await db.execute(sql`SELECT DISTINCT ON (pair_key) pair_key,verdict,features,created_at FROM intel_resolution_labels
    WHERE decided_by='human' AND verdict IN ('same','different') ORDER BY pair_key,created_at DESC LIMIT 2000`);
  return json({description:'Human-reviewed pre-decision snapshots. Keep this export private.',labels:labels.rows},{headers:{'Cache-Control':'no-store'}});
};
