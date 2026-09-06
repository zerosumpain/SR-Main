import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
/** Owner-only export of reviewed pre-decision snapshots for offline evaluation. */
export const GET: RequestHandler = async () => {
  const labels = await db.execute(sql`SELECT DISTINCT ON (pair_key) pair_key,verdict,features,created_at FROM intel_resolution_labels
    WHERE decided_by='human' AND verdict IN ('same','different') ORDER BY pair_key,created_at DESC LIMIT 2000`);
  return json({description:'Human-reviewed pre-decision snapshots. Keep this export private.',labels:labels.rows},{headers:{'Cache-Control':'no-store'}});
};
