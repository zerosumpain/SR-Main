import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyTrip } from '$lib/trips/family.server';
import { answerQuestion, parseQuestionAction } from '$lib/trips/questions.server';

/**
 * POST /api/native/trips/:id/questions/:qid — v8: answer a quick question
 * from the trip, the Home tile or a notification button.
 * `{ action: 'answer', answerId }` | `{ action: 'decide' }` | `{ action: 'skip' }`
 * | `{ action: 'vote', answerId }`. Members see and vote on family questions
 * only (an answer from them counts as a vote); a parent's or the creator's
 * answer decides. → `{ question, planVersion, changes, diff, undo, remember }`
 * (`remember` only ever for the owner). 404 for a question this caller cannot
 * see, 409 once it has been answered.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const act = parseQuestionAction(await event.request.json().catch(() => null));
  if (!act) return json({ error: 'Send action answer (with answerId), decide, skip or vote.' }, { status: 400 });
  const out = await answerQuestion(ft.trip, event.params.qid, act, {
    email: ft.caller.email,
    name: ft.caller.name,
    isOwner: ft.caller.isOwner,
    access: ft.access,
    surface: 'phone',
  });
  return json(out.body, { status: out.status });
});
