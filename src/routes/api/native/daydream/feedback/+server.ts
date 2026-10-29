import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { recordFeedback } from '$lib/daydream/thought-store';
import { parseFeedbackBody } from '$lib/daydream/think/notes';
import { thinkNoteKind } from '$lib/daydream/think/notes.server';
import { parseOwnerVerdict, recordOwnerVerdict } from '$lib/daydream/owner-verdict';
import { isReason } from '$lib/daydream/reasons';
import { recordReason } from '$lib/daydream/reasons.server';

/**
 * POST /api/native/daydream/feedback — `{ id, verdict: useful|not_useful|never }`,
 * a ruling on the claim: `{ id, verdict: wrong|right, why }` (why required
 * for wrong — it becomes the lesson), or a one-tap reason:
 * `{ id, reason: already_knew|not_my_thing|not_now|did_it }`.
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
  // `wrong` / `right` with a `why` are rulings on the claim, not ratings —
  // additive keys an older app never sends.
  const said = (body as Record<string, unknown> | null)?.verdict;
  if (said === 'wrong' || said === 'right') {
    const ruling = parseOwnerVerdict(body);
    if (!ruling.ok) return json({ error: ruling.error }, { status: 400 });
    if (!(await thinkNoteKind(ruling.thoughtId))) return json({ error: 'No such note' }, { status: 404 });
    await recordOwnerVerdict(ruling.thoughtId, ruling.verdict, ruling.why);
    return { ok: true };
  }
  // `{ id, reason }` — a one-tap reason (`reasons.ts`); additive, an older app
  // never sends it. "not_now" files the note with no verdict.
  const reason = (body as Record<string, unknown> | null)?.reason;
  if (reason !== undefined) {
    if (!isReason(reason)) return json({ error: 'reason must be already_knew, not_my_thing, not_now or did_it' }, { status: 400 });
    const id = typeof (body as Record<string, unknown>).id === 'string' ? ((body as Record<string, unknown>).id as string).trim() : '';
    if (!id || !(await thinkNoteKind(id))) return json({ error: 'No such note' }, { status: 404 });
    const res = await recordReason(id, reason);
    return { ok: true, ...res };
  }
  const parsed = parseFeedbackBody(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });

  if (!(await thinkNoteKind(parsed.id))) return json({ error: 'No such note' }, { status: 404 });
  await recordFeedback(parsed.id, parsed.verdict, undefined, 'explicit');
  // Worth knowing, and it needs something the site cannot do yet: on the
  // build list by itself, as from the web card (`act/solution.server.ts`).
  if (parsed.verdict === 'useful') {
    const { fileGapOnAccept } = await import('$lib/daydream/act/solution.server');
    const { backlogPorts } = await import('$lib/selfimprove/follow-ports.server');
    await fileGapOnAccept(parsed.id, backlogPorts).catch(() => null);
  }
  return { ok: true };
});
