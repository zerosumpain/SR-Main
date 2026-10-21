import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { familyPersonFor } from '$lib/family/roster.server';
import { ownerTrip, readJson } from '$lib/trips/api.server';
import { tripAccess } from '$lib/trips/family';
import { answerQuestion, parseQuestionAction } from '$lib/trips/questions.server';

/**
 * POST /api/trips/:id/questions/:qid — v8: answer a quick question.
 * `{ action: 'answer', answerId }` | `{ action: 'decide' }` (the assumed
 * answer) | `{ action: 'skip' }` | `{ action: 'vote', answerId }` (family
 * questions) → `{ question, planVersion, changes, diff, undo: { toVersion } | null,
 * remember }`. 404 for a question this caller cannot see, 409 once answered.
 */
export const POST: RequestHandler = async (event) => {
  const { owner, trip } = await ownerTrip(event);
  const act = parseQuestionAction(await readJson(event));
  if (!act) return json({ error: 'Send action answer (with answerId), decide, skip or vote.' }, { status: 400 });
  const person = await familyPersonFor(owner, true).catch(() => null);
  const out = await answerQuestion(trip, event.params.qid, act, {
    email: owner,
    name: person?.name ?? 'You',
    isOwner: true,
    access: tripAccess(trip.ownerEmail, { email: owner, parent: true }),
    surface: 'site',
  });
  return json(out.body, { status: out.status });
};
