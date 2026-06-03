// POST /api/workflows/orchestrator/chat/presence
//   body: { conversationId: string }  →  204
//
// The /jkai tab beats this every ~10s while it is visible and viewing a
// conversation. wa-escalation consults the resulting last-seen timestamp to
// suppress WhatsApp pings while the owner is actually watching. We deliberately
// do NOT beat on unload — letting presence go stale is exactly how "navigated
// away" is detected.
import type { RequestHandler } from './$types';
import { markPresent } from '$lib/workflows/chat/presence';

export const POST: RequestHandler = async ({ request }) => {
  let conversationId: string | null = null;
  try {
    const body = (await request.json()) as { conversationId?: string };
    conversationId = body?.conversationId ?? null;
  } catch {
    // ignore malformed body — treated as no-op heartbeat
  }
  if (conversationId) markPresent(conversationId);
  return new Response(null, { status: 204 });
};
