import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setHermesChatEnabled } from '$lib/server/models/settings';

// Owner-only: /api/admin/* is authed by default in hooks.server.ts. Mirrors the
// self-improvement kill-switch at /api/admin/improvement/toggle.
//
// Deliberately NOT under /api/admin/hermes/ despite being a Hermes control.
// That prefix is listed in PUBLIC_PATHS — it's the VPS→homeserv proxy for the
// session inspector and telemetry, gated per-handler by a HERMES_BRIDGE_SECRET
// bearer rather than by the session cookie. This endpoint is a browser action
// with no such bearer, so putting it there would have left it open to anyone.
//
// Chooses which engine answers /jkai chat: Hermes (terminal, file editing,
// skills, delegation, web search) or the in-repo generalChat loop (every site
// toolset, none of the above). Takes effect on the next message — no restart,
// no redeploy. Unset falls back to the JKAI_HERMES_CANVAS_CHAT env var.

/** POST { enabled: boolean } — pick the chat engine. */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== 'boolean') {
    return json({ error: '`enabled` must be a boolean' }, { status: 400 });
  }
  await setHermesChatEnabled(body.enabled);
  return json({ ok: true, enabled: body.enabled });
};
