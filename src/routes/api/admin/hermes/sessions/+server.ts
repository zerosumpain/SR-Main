import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertHermesServiceRequest } from '$lib/server/hermes-service-auth';
import { listSessions, searchSessions } from '$lib/server/hermes-sessions';

export const GET: RequestHandler = async ({ request, url }) => {
  assertHermesServiceRequest(request);
  const source = url.searchParams.get('source') ?? 'jkai';
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q) return json({ sessions: [], hits: await searchSessions(q, { source }) });
  return json({ sessions: await listSessions({ source }), hits: [] });
};
