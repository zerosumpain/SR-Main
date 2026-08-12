/**
 * Homeserv-side leg of the Hermes model surface, reached by the VPS through
 * `hermes-remote.ts`. Same shape and same auth as the sibling `/service`
 * endpoint: the shared bridge secret, not a user session, because the caller is
 * the other host rather than a browser.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertHermesServiceRequest } from '$lib/server/hermes-service-auth';
import { readHermesWorkloads, setHermesWorkload } from '$lib/server/hermes-models';
import { getWorkload } from '$lib/models/workloads';

export const GET: RequestHandler = async ({ request }) => {
  assertHermesServiceRequest(request);
  return json(await readHermesWorkloads());
};

export const POST: RequestHandler = async ({ request }) => {
  assertHermesServiceRequest(request);
  const body = (await request.json().catch(() => ({}))) as {
    workloadId?: unknown;
    modelId?: unknown;
  };

  const def = typeof body.workloadId === 'string' ? getWorkload(body.workloadId) : null;
  if (!def || def.scope !== 'hermes') throw error(400, 'unknown Hermes workload');
  if (typeof body.modelId !== 'string' || !body.modelId) throw error(400, 'invalid modelId');

  return json(await setHermesWorkload(def, body.modelId));
};
