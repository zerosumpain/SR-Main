import type { BuildQA } from '$lib/workflows/build-state.server';

/**
 * A Describe-it build that stops on a question (the generator's `followUp`)
 * waits for the owner instead of failing. Answering restarts the build from the
 * ORIGINAL prompt with every question so far and its answer appended, so the
 * generator starts clean each time and nothing the owner said is lost.
 *
 * At most `MAX_BUILD_QUESTIONS` per build: after that — or once the owner skips —
 * the generator is told to assume, and to say what it assumed.
 */

export const MAX_BUILD_QUESTIONS = 3;

export const SKIP_INSTRUCTION = 'Make reasonable assumptions for anything unspecified and state them in the description.';

export const CAP_INSTRUCTION =
  'Do not ask any more questions: proceed with your best assumptions and state them in the workflow description.';

export function composeBuildPrompt(prompt: string, qa: BuildQA[] = []): string {
  if (qa.length === 0) return prompt;
  const lines = qa.map((x) => `Q: ${x.q}\nA: ${x.a || '(skipped)'}`).join('\n');
  const tail = qa.length >= MAX_BUILD_QUESTIONS ? CAP_INSTRUCTION : qa.some((x) => !x.a) ? SKIP_INSTRUCTION : '';
  return `${prompt}\n\nEarlier questions and your answers:\n${lines}${tail ? `\n\n${tail}` : ''}`;
}
