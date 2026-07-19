import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createMonitor, listMonitors, setMonitorEnabled, deleteMonitor } from '$lib/monitors/monitors.server';

// Manage natural-language monitors. Owner-gated by hooks.

export const GET: RequestHandler = async () => {
  return json({ monitors: await listMonitors() });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const description = typeof body.description === 'string' ? body.description : '';
  if (!description.trim()) return json({ error: 'description is required' }, { status: 400 });
  const cron = typeof body.cron === 'string' && body.cron.trim() ? body.cron.trim() : undefined;
  // Generation can take a while; bound it so the request cannot hang forever.
  try {
    const marker = await createMonitor(description, cron);
    return json({ monitor: marker });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'create failed' }, { status: 500 });
  }
};

export const PATCH: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const workflowId = typeof body.workflowId === 'string' ? body.workflowId : '';
  if (!workflowId) return json({ error: 'workflowId required' }, { status: 400 });
  try {
    return json(await setMonitorEnabled(workflowId, body.enabled !== false));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'update failed' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  const workflowId = url.searchParams.get('workflowId');
  if (!workflowId) return json({ error: 'workflowId query param required' }, { status: 400 });
  try {
    return json(await deleteMonitor(workflowId));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'delete failed' }, { status: 500 });
  }
};
