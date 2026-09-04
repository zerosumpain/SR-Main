import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import { requireActivityConnection } from '$lib/activity/store/connections.server';
import { enqueueActivityJob } from '$lib/activity/sync/queue.server';
import { activityErrorResponse, activityProblem, readIdempotencyKey } from '$lib/activity/http.server';

export const POST: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const idempotencyKey = readIdempotencyKey(event.request);
    if (!idempotencyKey) {
      return activityProblem(400, 'idempotency_key_required', 'Sync requests require Idempotency-Key');
    }
    const connection = await requireActivityConnection(principal.id, event.params.id);
    if (connection.mode === 'import') {
      return activityProblem(409, 'import_connection', 'Upload an archive instead of syncing this connection');
    }
    if (connection.status === 'erasing' || connection.status === 'disconnected') {
      return activityProblem(409, 'connection_inactive', 'This connection cannot be synced');
    }
    const job = await enqueueActivityJob({
      principalId: principal.id,
      connectionId: connection.id,
      provider: connection.provider,
      kind: connection.lastSyncSucceededAt ? 'incremental_sync' : 'initial_sync',
      idempotencyKey: `sync:${connection.id}:${idempotencyKey}`,
    });
    return json({ accepted: true, jobId: job.id, duplicate: !job.inserted }, { status: 202 });
  } catch (error) {
    return activityErrorResponse(error);
  }
};
