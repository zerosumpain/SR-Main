import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { thinkNoteKind } from '$lib/daydream/think/notes.server';
import { FOLLOW_OPS, isFollowOp, runFollow } from '$lib/daydream/act/follow.server';
import { backlogPorts } from '$lib/selfimprove/follow-ports.server';

/**
 * POST /api/native/daydream/follow — "Take it further" from the phone.
 *
 *   { id, op, description?, entities? } → { ok: true, message, href? } | { ok: false, reason }
 *
 * `op` is one of `FOLLOW_OPS` — the same taps, through the same service, as
 * the web card (`act/follow.server.ts`). `description` is a watch's wording;
 * `entities` the Home Assistant devices picked to refresh. A refusal is a 200
 * with the reason: an answer to show, not a fault.
 */
export const POST: RequestHandler = withDevice(async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return json({ error: 'Body must be a JSON object' }, { status: 400 });
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id || id.length > 200) return json({ error: 'id is required' }, { status: 400 });
  if (!isFollowOp(body.op)) return json({ error: `op must be one of ${FOLLOW_OPS.join(', ')}` }, { status: 400 });
  if (!(await thinkNoteKind(id))) return json({ error: 'No such note' }, { status: 404 });
  return json(await runFollow(id, body.op, { description: body.description, entities: body.entities }, backlogPorts));
});
