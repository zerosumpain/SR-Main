import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertHermesServiceRequest } from '$lib/server/hermes-service-auth';
import { getPairState, startPairing, cancelPairing } from '$lib/server/hermes-whatsapp';

/** Current pairing state, including the freshly-rendered QR. Polled by the
 *  page every couple of seconds because WhatsApp rotates the code ~every 20s. */
export const GET: RequestHandler = async ({ request }) => {
  assertHermesServiceRequest(request);
  return json(await getPairState());
};

export const POST: RequestHandler = async ({ request }) => {
  assertHermesServiceRequest(request);
  const body = (await request.json().catch(() => ({}))) as { op?: unknown };
  if (body?.op === 'start') return json(await startPairing());
  if (body?.op === 'cancel') return json(await cancelPairing());
  throw error(400, 'op must be "start" or "cancel"');
};
