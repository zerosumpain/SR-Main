import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertHermesServiceRequest } from '$lib/server/hermes-service-auth';
import { getSession, isValidSessionId } from '$lib/server/hermes-sessions';

export const GET: RequestHandler = async ({ request, params }) => {
  assertHermesServiceRequest(request);
  if (!isValidSessionId(params.id)) throw error(400, 'invalid session id');
  return json(await getSession(params.id));
};
