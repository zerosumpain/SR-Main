import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { parseDecision } from '$lib/captures/validate';
import { recorderSpace } from '$lib/captures/store.server';
import { decideAction, isRefusal } from '$lib/captures/service.server';
import { toActionView } from '$lib/captures/view';

/**
 * POST /api/native/captures/:id/actions/:actionId — `{decision, params?}`.
 *
 * A new write path on the device lane, narrow by design (PLAN "Follow-ups"):
 * only these rows, only the recorder's own, one explicit tap each. Approving
 * runs the action server side straight away (research starts and answers
 * `approved`, finishing in the background); dismissing only records it. A row
 * that is no longer `proposed` is a 409, so a double tap cannot run twice.
 */
export const POST: RequestHandler = withDevice(async ({ params, request }) => {
  const parsed = parseDecision(await request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const out = await decideAction(recorderSpace(), params.id, params.actionId, parsed.value);
  if (isRefusal(out)) return json({ error: out.error }, { status: out.status });
  return toActionView(out);
});
