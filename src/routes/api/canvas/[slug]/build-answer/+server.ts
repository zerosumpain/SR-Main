import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { answerBuildQuestion } from '$lib/canvas/build-answer.server';
import { findCanvas } from '$lib/workflows/native/workflows.server';

/**
 * POST /api/canvas/:slug/build-answer { answer?: string, skip?: boolean }
 * → 202 { building: true } | 409 not waiting on a question | 422 no answer
 *
 * The canvas building banner's answer box. Same `answerBuildQuestion` the
 * iPhone's /answer calls. Owner-only via the /api gate.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Canvas not found' }, { status: 404 });
  const out = await answerBuildQuestion(workflow.id, body);
  return json(out.body, { status: out.status });
};
