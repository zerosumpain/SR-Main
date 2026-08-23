import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assertHermesServiceRequest } from '$lib/server/hermes-service-auth';
import { getWhatsAppStatus, runWhatsAppAction, isWhatsAppAction } from '$lib/server/hermes-whatsapp';

/** Live bridge + session state. Read-only: never touches the bridge's
 *  /messages endpoint, which would drain the inbound queue. */
export const GET: RequestHandler = async ({ request }) => {
  assertHermesServiceRequest(request);
  return json(await getWhatsAppStatus());
};

/** Restart the bridge, or unlink the session so it can be paired afresh. */
export const POST: RequestHandler = async ({ request }) => {
  assertHermesServiceRequest(request);
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  if (!isWhatsAppAction(body?.action)) throw error(400, 'unknown WhatsApp action');
  return json(await runWhatsAppAction(body.action));
};
