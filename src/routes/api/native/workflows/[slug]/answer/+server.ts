import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { withDevice } from '$lib/server/native-handler';
import { answerBuildQuestion } from '$lib/canvas/build-answer.server';
import { findCanvas } from '$lib/workflows/native/workflows.server';

/**
 * POST /api/native/workflows/:slug/answer { answer?: string, skip?: boolean }
 * → 202 { building: true } | 409 not waiting on a question | 422 no answer
 *
 * Answers the question a Describe-it build stopped on (detail `question`) and
 * restarts the build — the same `answerBuildQuestion` the canvas calls.
 */
export const POST: RequestHandler = withDevice(async ({ params, request }) => {
  let body: unknown;
  try {
    body = (await request.json()) ?? {};
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });
  const out = await answerBuildQuestion(workflow.id, body);
  return json(out.body, { status: out.status });
});
