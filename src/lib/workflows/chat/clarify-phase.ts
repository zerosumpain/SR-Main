import { publishJobEvent, createWaiter, getJob } from './job-store';
import type { ClarifyQuestion } from './job-store';
import { notifyAllSubscribers } from '$lib/server/push';

const CLARIFY_RE = /<clarify>([\s\S]*?)<\/clarify>/;

export function extractClarify(text: string): { questions: ClarifyQuestion[]; cleaned: string } | null {
  const m = text.match(CLARIFY_RE);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1].trim());
    if (!parsed || !Array.isArray(parsed.questions) || parsed.questions.length === 0) return null;
    const questions: ClarifyQuestion[] = parsed.questions.slice(0, 3).map((q: any, i: number) => ({
      id: typeof q.id === 'string' && q.id.length > 0 ? q.id : `q${i + 1}`,
      text: String(q.text ?? ''),
      kind: q.kind === 'choice' ? 'choice' : 'freeform',
      choices: Array.isArray(q.choices) ? q.choices.map(String) : undefined,
    })).filter((q: ClarifyQuestion) => q.text.length > 0);
    if (questions.length === 0) return null;
    return { questions, cleaned: text.replace(CLARIFY_RE, '').trim() };
  } catch {
    return null;
  }
}

export async function awaitClarifyAnswers(
  jobId: string,
  questions: ClarifyQuestion[],
): Promise<{ answers: Record<string, string> }> {
  const clarifyId = crypto.randomUUID();
  publishJobEvent(jobId, { type: 'clarify', clarifyId, questions });
  try {
    const conversationId = getJob(jobId)?.scope.conversationId ?? null;
    const first = questions[0]?.text ?? '';
    const extra = questions.length > 1 ? ` (+${questions.length - 1} more)` : '';
    void notifyAllSubscribers({
      title: 'Clarification needed',
      body: `${first}${extra}`.slice(0, 200),
      url: conversationId ? `/jkai?c=${conversationId}` : '/jkai',
    }).catch((e) => console.warn('[jkai-pwa] approval push failed', e));
  } catch (e) {
    console.warn('[jkai-pwa] approval push failed', e);
  }
  const { awaitResponse } = createWaiter<{ answers: Record<string, string> }>(
    jobId,
    `clarify:${clarifyId}`,
  );
  return awaitResponse();
}
