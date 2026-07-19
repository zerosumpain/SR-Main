import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAgents, upsertAgent, deleteAgent } from '$lib/agents/store';

// Manage the persistent agent team. Owner-gated by hooks (/api/jkai/* is owner-only).

export const GET: RequestHandler = async () => {
  return json({ agents: await listAgents() });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  if (!body.name || typeof body.name !== 'string') {
    return json({ error: 'name is required' }, { status: 400 });
  }
  try {
    const agent = await upsertAgent({
      name: body.name,
      role: typeof body.role === 'string' ? body.role : undefined,
      persona: typeof body.persona === 'string' ? body.persona : undefined,
      allowedTools: Array.isArray(body.allowedTools)
        ? body.allowedTools.filter((t: unknown): t is string => typeof t === 'string')
        : undefined,
      model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
    });
    return json({ agent });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'upsert failed' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const name = url.searchParams.get('name');
  if (!name) return json({ error: 'name query param required' }, { status: 400 });
  try {
    return json(await deleteAgent(name));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'delete failed' }, { status: 500 });
  }
};
