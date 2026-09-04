import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOwnerActivityPrincipal } from '$lib/activity/principal.server';
import {
  requestActivityConnectionErasure,
  requireActivityConnection,
} from '$lib/activity/store/connections.server';
import { listActivityGrants } from '$lib/activity/store/grants.server';
import { activityErrorResponse, activityProblem, readIdempotencyKey } from '$lib/activity/http.server';
import { publicActivityConnection, publicActivityGrant } from '$lib/activity/public.server';

export const GET: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const connection = await requireActivityConnection(principal.id, event.params.id);
    const grants = await listActivityGrants(principal.id, connection.id);
    return json({
      connection: publicActivityConnection(connection),
      grants: grants.map(publicActivityGrant),
    });
  } catch (error) {
    return activityErrorResponse(error);
  }
};

export const DELETE: RequestHandler = async (event) => {
  const principal = await requireOwnerActivityPrincipal(event);
  try {
    const idempotencyKey = readIdempotencyKey(event.request);
    if (!idempotencyKey) {
      return activityProblem(400, 'idempotency_key_required', 'Deleting a connection requires Idempotency-Key');
    }
    const connection = await requireActivityConnection(principal.id, event.params.id);
    const job = await requestActivityConnectionErasure(principal.id, connection.id);
    return json({ accepted: true, jobId: job.jobId, duplicate: !job.inserted }, { status: 202 });
  } catch (error) {
    return activityErrorResponse(error);
  }
};
