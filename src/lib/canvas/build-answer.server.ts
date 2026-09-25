import { buildInBackground } from '$lib/workflows/build-from-prompt.server';
import { readPendingQuestion, recordBuildState } from '$lib/workflows/build-state.server';

/**
 * Answer the question a Describe-it build stopped on, and restart it.
 *
 * ONE function behind both doors — the canvas (`POST /api/canvas/:slug/build-answer`)
 * and the phone (`POST /api/native/workflows/:slug/answer`) — so they cannot
 * drift. The body is taken raw: `{ answer?: string, skip?: boolean }`.
 * `skip` records the question with an empty answer, which tells the generator
 * to assume (see `composeBuildPrompt`).
 */
export async function answerBuildQuestion(
  workflowId: string,
  body: unknown,
): Promise<{ status: 202 | 409 | 422; body: Record<string, unknown> }> {
  const b = (body && typeof body === 'object' ? body : {}) as { answer?: unknown; skip?: unknown };
  const skip = b.skip === true;
  const answer = skip ? '' : typeof b.answer === 'string' ? b.answer.trim().slice(0, 2000) : '';
  if (!skip && !answer) return { status: 422, body: { error: 'Type an answer, or skip.', field: 'answer' } };

  const pending = await readPendingQuestion(workflowId);
  if (!pending) return { status: 409, body: { error: 'This workflow is not waiting on a question.' } };

  const { prompt, title } = pending.resume;
  const qa = [...(pending.resume.qa ?? []), { q: pending.question, a: answer }];
  const said = skip ? 'Skipped — jkai will use its best guess.' : `Your answer: “${answer.length > 300 ? `${answer.slice(0, 299)}…` : answer}”`;
  await recordBuildState(workflowId, 'building', `${said} Building it now.`, { resume: { prompt, title, attempt: 1, qa } });
  void buildInBackground(workflowId, prompt, title, qa).catch((err) => {
    console.error(`[build-answer] ${workflowId} failed outside its own handler`, err);
  });
  return { status: 202, body: { building: true } };
}
