// POST /api/whatsapp/inbound — delegated-mode inbound relay.
//
// In the DELEGATED topology (WHATSAPP_HERMES_BRIDGE_URL set — production on
// homeserv) Hermes owns the WhatsApp connection and our OrchestratorBridge is
// never wired, so the D2 approval-reply and D3 whatsapp-trigger inbound handlers
// have no way to fire. This endpoint is the entry point Hermes relays owner
// messages to BEFORE its own chat handling: it runs the exact same
// interceptOwnerInbound(from, text) sequence the bridge uses and returns
// { handled, reply } so Hermes can send the reply and skip normal chat when we
// consumed the message.
//
// Auth: requires a Bearer token matching WHATSAPP_INBOUND_SECRET (mirrors the
// policy-engine / scraper service-to-service routes). If the secret is UNSET the
// endpoint is disabled (503) — it dispatches workflows and resolves approvals,
// so it must never be open. The intercept functions are also owner-gated
// internally (defence in depth). Body: { from: string, text: string }.

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { interceptOwnerInbound } from '$lib/workflows/whatsapp/inbound-intercept';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const secret = env.WHATSAPP_INBOUND_SECRET;
  if (!secret) throw error(503, 'whatsapp inbound relay is not configured');
  if ((request.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    throw error(401, 'unauthorized');
  }

  const body = (await request.json().catch(() => ({}))) as { from?: unknown; text?: unknown };
  const from = typeof body.from === 'string' ? body.from : '';
  const text = typeof body.text === 'string' ? body.text : '';
  if (!from) throw error(400, 'from is required');

  const result = await interceptOwnerInbound(from, text);
  return json(result);
};
