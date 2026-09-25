import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { recordFeedback } from '$lib/daydream/thought-store';
import { parseFeedbackBody } from '$lib/daydream/think/notes';
import { thinkNoteKind } from '$lib/daydream/think/notes.server';

/**
 * POST /api/native/daydream/feedback — `{ id, verdict: useful|not_useful|never }`.
 *
 * The same writer as the feed's buttons and the WhatsApp reply
 * (`recordFeedback`), so a verdict from the phone moves the kind's weight
 * exactly as one from the desk does. `never` is the kind mute — one tap, final.
 *
 * Only think notes: the phone is shown nothing else, so an id that is not one
 * is a 404 rather than a way to rate an arbitrary ledger row.
 */
export const POST: RequestHandler = withDevice(async ({ request }) => {
  const body = await request.json().catch(() => null);
  const parsed = parseFeedbackBody(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });

  if (!(await thinkNoteKind(parsed.id))) return json({ error: 'No such note' }, { status: 404 });
  await recordFeedback(parsed.id, parsed.verdict, undefined, 'explicit');
  return { ok: true };
});
