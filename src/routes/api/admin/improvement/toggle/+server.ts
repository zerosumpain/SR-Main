import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setSetting } from '$lib/server/models/settings';
import { SETTINGS_ENABLED_KEY } from '$lib/selfimprove/types';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). Flips the nightly
// engine kill-switch (`selfimprove.enabled`). Default (unset) is treated as
// enabled by the engine, so an explicit `false` is what pauses it.

/** POST { enabled: boolean } — set the kill-switch. */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== 'boolean') {
    return json({ error: '`enabled` must be a boolean' }, { status: 400 });
  }
  await setSetting(SETTINGS_ENABLED_KEY, body.enabled);
  return json({ ok: true, enabled: body.enabled });
};
