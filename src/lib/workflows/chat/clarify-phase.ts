import { publishJobEvent, createWaiter } from './job-store';
import type { ClarifyQuestion } from './job-store';
import { notifyGate } from './gate-notify';

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
  const first = questions[0]?.text ?? '';
  const extra = questions.length > 1 ? ` (+${questions.length - 1} more)` : '';
  // No gate ids: the phone answers a gate by PATCHing SR-Jkai-Core, and a turn
  // running here (the WhatsApp worker) is not a job Core can find. A plain
  // alert that opens the chat, owner turns only.
  notifyGate(jobId, { title: 'Clarification needed', body: `${first}${extra}` }, null);
  const { awaitResponse } = createWaiter<{ answers: Record<string, string> }>(
    jobId,
    `clarify:${clarifyId}`,
  );
  return awaitResponse();
}
