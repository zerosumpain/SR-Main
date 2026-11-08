import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { fileStale, keepCurrent, thinkNoteKind } from '$lib/daydream/think/notes.server';

/**
 * POST /api/native/daydream/shelf — a note past its date, from the phone.
 *
 *   { id, op: "file" }      → { ok, filed }  — off the Inbox (`expired`)
 *   { all: true, op: "file" } → { ok, filed } — every note flagged right now
 *   { id, op: "keep" }      → { ok, until }  — "Still relevant", a fortnight
 *
 * The same writers as the web card (`notes.server.ts`). Filing re-reads which
 * notes are flagged, so `filed: 0` for a note that is not is an answer, not
 * a fault.
 */
export const POST: RequestHandler = withDevice(async ({ request }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return json({ error: 'Body must be a JSON object' }, { status: 400 });
  const op = body.op;
  if (op !== 'file' && op !== 'keep') return json({ error: 'op must be file or keep' }, { status: 400 });
  if (op === 'file' && body.all === true) return { ok: true, filed: await fileStale('all') };
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id || id.length > 200) return json({ error: 'id is required' }, { status: 400 });
  if (!(await thinkNoteKind(id))) return json({ error: 'No such note' }, { status: 404 });
  if (op === 'file') return { ok: true, filed: await fileStale([id]) };
  const until = await keepCurrent(id);
  return until ? { ok: true, until } : json({ error: 'No such note' }, { status: 404 });
});
