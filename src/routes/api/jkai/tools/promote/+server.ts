// src/routes/api/jkai/tools/promote/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { executeSiteTool } from '$lib/tools/executor';
import { ownerActionPrincipal } from '$lib/tools/in-process-principal';

type PromoteBody = {
  messageId?: string;
  toolCallId?: string;
  name?: string;
  description?: string;
  toolset?: string;
};

export const POST: RequestHandler = async ({ request }) => {
  let body: PromoteBody;
  try {
    body = (await request.json()) as PromoteBody;
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body.messageId) return json({ error: 'messageId is required' }, { status: 400 });
  if (!body.toolCallId) return json({ error: 'toolCallId is required' }, { status: 400 });

  const res = await executeSiteTool('promote_ephemeral_tool', {
    messageId: body.messageId,
    toolCallId: body.toolCallId,
    name: body.name,
    description: body.description,
    toolset: body.toolset,
  }, {
    emit: () => {},
    // The owner's "keep this tool" press (the route is owner-gated in
    // hooks.server.ts): it IS the answer to the destructive gate.
    principal: ownerActionPrincipal('promote-ephemeral-tool'),
  });

  if (!res.success) return json({ error: res.error ?? 'promotion failed' }, { status: 400 });
  return json(res.data ?? {});
};
