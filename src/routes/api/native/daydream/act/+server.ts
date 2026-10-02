import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { thinkNoteKind } from '$lib/daydream/think/notes.server';
import { chooseCalendar, doIt, sendIt, undoIt } from '$lib/daydream/act/act.server';

/**
 * POST /api/native/daydream/act — "Do it for me" from the phone.
 *
 *   { id, op: "do" }                → ActResult
 *   { id, op: "undo" }              → ActResult
 *   { id, op: "send" }              → ActResult — a draft's second tap
 *   { op: "calendar", calendar }    → { ok } — the one-time choice
 *
 * The same service as the web card. A refusal is `{ ok: false, reason }` with
 * a 200 — it is an answer to show, not a fault; `needsCalendar` carries the
 * names to choose from.
 */
export const POST: RequestHandler = withDevice(async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return json({ error: 'Body must be a JSON object' }, { status: 400 });
  const op = body.op;
  if (op === 'calendar') {
    const name = typeof body.calendar === 'string' ? body.calendar.trim() : '';
    if (!name) return json({ error: 'calendar is required' }, { status: 400 });
    const result = await chooseCalendar(name);
    return json(result, { status: result.ok ? 200 : 400 });
  }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id || id.length > 200) return json({ error: 'id is required' }, { status: 400 });
  if (op !== 'do' && op !== 'undo' && op !== 'send') return json({ error: 'op must be do, undo, send or calendar' }, { status: 400 });
  if (!(await thinkNoteKind(id))) return json({ error: 'No such note' }, { status: 404 });
  return json(op === 'do' ? await doIt(id) : op === 'send' ? await sendIt(id) : await undoIt(id));
});
