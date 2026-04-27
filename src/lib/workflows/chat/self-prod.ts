import type { OrchestratorJob } from './job-store';

const QUESTION_PHRASES = [
  'should i', 'would you like', 'do you want', 'let me know',
  'shall i', 'do you prefer', 'any preference',
];

export function shouldSelfProd(job: OrchestratorJob, replyText: string): boolean {
  if (!job.plan) return false;
  if (job.selfProdCount >= 2) return false;
  if (job.awaitingWaiter) return false;

  const uncovered = job.plan.steps.filter((s) => !job.coveredStepIds.has(s.id));
  if (uncovered.length === 0) return false;

  const trimmed = replyText.trim();
  if (!trimmed) return false;

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const lastLine = lines[lines.length - 1] ?? '';
  if (lastLine.endsWith('?')) return false;

  const lower = trimmed.toLowerCase();
  if (QUESTION_PHRASES.some((p) => lower.includes(p))) return false;

  return true;
}

export function buildProdMessage(job: OrchestratorJob): string {
  const remaining = (job.plan?.steps ?? [])
    .filter((s) => !job.coveredStepIds.has(s.id))
    .map((s) => `- ${s.title}`)
    .join('\n');

  // selfProdCount is read AFTER the caller has incremented it,
  // so the first prod sees count=1 and the second sees count=2.
  if (job.selfProdCount <= 1) {
    return `The plan still has uncovered steps:\n${remaining}\n\nContinue with the next step now. If a step is genuinely blocked or no longer applicable, say so and stop; otherwise proceed.`;
  }
  return `You paused again without finishing. The remaining plan steps:\n${remaining}\n\nList which step is blocking you, what is needed to unblock it, and either continue or stop with a clear reason.`;
}
