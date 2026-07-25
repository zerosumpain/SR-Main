// Owner-gated (hooks.server.ts). Classify a first-message query and return the
// routed model for the client to apply (via the existing switchModel path).
// Best-effort: on any failure returns enabled:false so the chat falls back to
// the conversation's current model.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveRouting } from '$lib/routing/resolve';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const message = typeof body?.message === 'string' ? body.message : '';
  try {
    const result = await resolveRouting({
      message,
      workflowId: body?.workflowId ?? null,
      mode: body?.mode ?? null,
      hasAttachments: body?.hasAttachments === true,
      conversationId: typeof body?.conversationId === 'string' ? body.conversationId : null,
    });
    return json(result);
  } catch {
    return json({
      enabled: false,
      profile: 'general',
      profileLabel: 'General chat',
      provider: 'openrouter',
      modelId: null,
      source: null,
      caps: null,
      reason: 'error',
    });
  }
};
