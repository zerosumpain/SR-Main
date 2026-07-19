import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { delegateToAgent } from '$lib/agents/delegate';

/**
 * Delegate a task to a named specialist agent and return its result. Owner-gated
 * by hooks. Runs a full sub-agent turn, so it can take a while — the client
 * should show a working state. Bounded so a stuck model doesn't hang forever.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const agent = typeof body.agent === 'string' ? body.agent : '';
  const task = typeof body.task === 'string' ? body.task : '';
  if (!agent || !task) return json({ error: 'agent and task are required' }, { status: 400 });

  try {
    const result = await delegateToAgent(agent, task);
    return json({ result });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'delegation failed' }, { status: 500 });
  }
};
