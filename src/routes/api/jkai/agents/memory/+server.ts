import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTeamMemory, deleteTeamMemory } from '$lib/agents/store';

// Shared team-memory visibility for /jkai/agents. Owner-gated by hooks.

export const GET: RequestHandler = async () => {
  return json({ memory: await listTeamMemory() });
};

export const DELETE: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id query param required' }, { status: 400 });
  try {
    return json(await deleteTeamMemory(id));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'delete failed' }, { status: 500 });
  }
};
