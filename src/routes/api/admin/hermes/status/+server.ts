import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertHermesServiceRequest } from '$lib/server/hermes-service-auth';
import { getStatus } from '$lib/server/hermes-control';

export const GET: RequestHandler = async ({ request }) => {
  assertHermesServiceRequest(request);
  return json(await getStatus());
};
