import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCollectionBySlug, queryRecords } from '$lib/datastore';
import { getImprovementStatus } from '$lib/selfimprove/run';
import { COLLECTIONS } from '$lib/selfimprove/types';

// Owner-only (enforced in hooks.server.ts for /api/admin/*; on the homeserv LAN
// the hook bypasses auth entirely, so this handler adds no session re-check —
// same pattern as the other /api/admin endpoints). Reads run records via the
// datastore access layer as the `owner` actor.

const OWNER = 'owner';

/** Last 30 improvement runs, newest first. Empty until the engine seeds. */
async function loadRuns() {
  if (!(await getCollectionBySlug(COLLECTIONS.improvementRuns))) return [];
  const { records } = await queryRecords(
    COLLECTIONS.improvementRuns,
    { sort: { field: 'createdAt', dir: 'desc' }, limit: 30 },
    OWNER,
  );
  return records.map((r) => ({ runId: r.key, createdAt: r.createdAt, data: r.data }));
}

/** GET — the recent runs plus the live engine status (drives the poll loop). */
export const GET: RequestHandler = async () => {
  const runs = await loadRuns();
  return json({ runs, status: getImprovementStatus() });
};
