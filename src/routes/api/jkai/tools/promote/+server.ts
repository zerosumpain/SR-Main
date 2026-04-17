// src/routes/api/jkai/tools/promote/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { executeTool } from '$lib/workflows/site-tools/registry';

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

  const res = await executeTool('promote_ephemeral_tool', {
    messageId: body.messageId,
    toolCallId: body.toolCallId,
    name: body.name,
    description: body.description,
    toolset: body.toolset,
  });

  if (!res.success) return json({ error: res.error ?? 'promotion failed' }, { status: 400 });
  return json(res.data ?? {});
};
