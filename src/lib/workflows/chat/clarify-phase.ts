import { publishJobEvent, createWaiter } from './job-store';
import type { ClarifyQuestion } from './job-store';

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
  const { awaitResponse } = createWaiter<{ answers: Record<string, string> }>(
    jobId,
    `clarify:${clarifyId}`,
  );
  return awaitResponse();
}
