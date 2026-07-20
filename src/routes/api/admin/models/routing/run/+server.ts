// Owner-gated (hooks.server.ts). Trigger a model-selection run now.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runSelectionNow, isSelectionRunning } from '$lib/routing/run';

export const POST: RequestHandler = async ({ request }) => {
  if (isSelectionRunning()) throw error(409, 'a selection is already running');
  const body = await request.json().catch(() => ({}));
  const { run } = await runSelectionNow({
    trigger: 'manual',
    skipNotify: body?.skipNotify === true,
  });
  return json({ ok: run.status === 'complete', run });
};
