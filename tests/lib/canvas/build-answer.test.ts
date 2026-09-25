import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Answering the question a Describe-it build stopped on restarts it — one
 * function behind the canvas's /build-answer and the phone's /answer.
 */

let pending: { question: string; resume: { prompt: string; title: string | null; attempt: number; qa?: Array<{ q: string; a: string }> } } | null;
const recordBuildState = vi.fn(async (..._a: unknown[]) => {});
vi.mock('$lib/workflows/build-state.server', () => ({
  readPendingQuestion: async () => pending,
  recordBuildState: (...a: unknown[]) => recordBuildState(...a),
}));
const buildInBackground = vi.fn(async (..._a: unknown[]) => {});
vi.mock('$lib/workflows/build-from-prompt.server', () => ({
  buildInBackground: (...a: unknown[]) => buildInBackground(...a),
}));

import { answerBuildQuestion } from '$lib/canvas/build-answer.server';
import { composeBuildPrompt, MAX_BUILD_QUESTIONS } from '$lib/canvas/build-questions';

beforeEach(() => {
  pending = { question: 'What calendar date should the jokes stop at?', resume: { prompt: 'jokes till 6pm today', title: 'Jokes', attempt: 1, qa: [] } };
  recordBuildState.mockClear();
  buildInBackground.mockClear();
});

describe('answerBuildQuestion', () => {
  it('appends the answer to the Q&A, marks it building and restarts from the original prompt', async () => {
    pending!.resume.qa = [{ q: 'Which phone?', a: 'mine' }];
    const out = await answerBuildQuestion('wf-1', { answer: '  25 September  ' });
    expect(out).toEqual({ status: 202, body: { building: true } });
    const qa = [{ q: 'Which phone?', a: 'mine' }, { q: 'What calendar date should the jokes stop at?', a: '25 September' }];
    expect(buildInBackground).toHaveBeenCalledWith('wf-1', 'jokes till 6pm today', 'Jokes', qa);
    const [, status, , extra] = recordBuildState.mock.calls[0] as [string, string, string, { resume: unknown }];
    expect(status).toBe('building');
    expect(extra.resume).toEqual({ prompt: 'jokes till 6pm today', title: 'Jokes', attempt: 1, qa });
    expect(composeBuildPrompt('jokes till 6pm today', qa)).toBe(
      'jokes till 6pm today\n\nEarlier questions and your answers:\nQ: Which phone?\nA: mine\nQ: What calendar date should the jokes stop at?\nA: 25 September',
    );
  });

  it('skip records an empty answer, which tells the generator to assume', async () => {
    expect((await answerBuildQuestion('wf-1', { skip: true, answer: 'ignored' })).status).toBe(202);
    const qa = buildInBackground.mock.calls[0][3] as Array<{ q: string; a: string }>;
    expect(qa).toEqual([{ q: 'What calendar date should the jokes stop at?', a: '' }]);
    expect(composeBuildPrompt('p', qa)).toMatch(/A: \(skipped\)\n\nMake reasonable assumptions for anything unspecified and state them in the description\.$/);
  });

  it('409s a canvas that is not waiting on a question, 422s an empty answer — starting nothing', async () => {
    expect((await answerBuildQuestion('wf-1', { answer: '   ' })).status).toBe(422);
    expect((await answerBuildQuestion('wf-1', null)).status).toBe(422);
    pending = null;
    expect((await answerBuildQuestion('wf-1', { answer: 'x' })).status).toBe(409);
    expect(buildInBackground).not.toHaveBeenCalled();
    expect(recordBuildState).not.toHaveBeenCalled();
  });

  it('after three questions the generator is told to stop asking', () => {
    const qa = Array.from({ length: MAX_BUILD_QUESTIONS }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));
    expect(MAX_BUILD_QUESTIONS).toBe(3);
    expect(composeBuildPrompt('p', qa)).toMatch(/Do not ask any more questions: proceed with your best assumptions and state them in the workflow description\.$/);
    expect(composeBuildPrompt('p', qa.slice(0, 2))).not.toMatch(/Do not ask/);
    expect(composeBuildPrompt('p')).toBe('p');
  });
});
