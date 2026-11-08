import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { withNativeAccess } from '$lib/server/native-handler';
import { driveCaller, intelFile, intelStatus } from '$lib/drive/native-drive';

/**
 * POST /api/native/drive/files/:id/intel — "Extract entities": queues the file
 * for the knowledge graph. 202 `{jobId, status:'queued'}`. Owner only.
 */
export const POST: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const queued = await intelFile(await driveCaller(event, identity, role), event.params.id);
  return json(queued, { status: 202 });
});

/** GET ?job= — that job's state (no note id). Owner only. */
export const GET: RequestHandler = withNativeAccess('drive', async (event, identity, role) => {
  const raw = event.url.searchParams.get('job');
  const job = raw === null || raw === '' ? null : Number(raw);
  if (job !== null && (!Number.isInteger(job) || job < 1)) throw error(400, 'job must be a job id');
  return intelStatus(await driveCaller(event, identity, role), event.params.id, job);
});
