import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { thinkNoteKind } from '$lib/daydream/think/notes.server';
import { runSolution, undoSolution } from '$lib/daydream/act/solution.server';
import { backlogPorts } from '$lib/selfimprove/follow-ports.server';

/**
 * POST /api/native/daydream/solve — a note's solution from the phone.
 *
 *   { id, op: 'solve' | 'undo' } → { ok: true, message, href? } | { ok: false, reason }
 *
 * The same service as the web card (`act/solution.server.ts`): one press
 * carries the solution out and counts the note as worth knowing; `undo` stops
 * a tracker or turns the lights back on. A refusal is a 200 with the reason.
 */
export const POST: RequestHandler = withDevice(async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return json({ error: 'Body must be a JSON object' }, { status: 400 });
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id || id.length > 200) return json({ error: 'id is required' }, { status: 400 });
  if (body.op !== 'solve' && body.op !== 'undo') return json({ error: 'op must be solve or undo' }, { status: 400 });
  if (!(await thinkNoteKind(id))) return json({ error: 'No such note' }, { status: 404 });
  return json(body.op === 'undo' ? await undoSolution(id) : await runSolution(id, backlogPorts));
});
