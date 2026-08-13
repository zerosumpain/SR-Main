import { publishJobEvent, createWaiter, getJob } from './job-store';
import type { PlanPayload } from './job-store';
import { notifyAllSubscribers } from '$lib/server/push';

const PLAN_RE = /<plan>([\s\S]*?)<\/plan>/;

/**
 * Extract a <plan>{JSON}</plan> block from an assistant response. Returns
 * the parsed payload and the remaining content with the tag stripped.
 * Returns null if no plan block is present or parsing fails.
 */
export function extractPlan(text: string): { plan: PlanPayload; cleaned: string } | null {
  const m = text.match(PLAN_RE);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1].trim());
    if (!parsed || !Array.isArray(parsed.steps) || parsed.steps.length === 0) return null;
    const filesToTouch = Array.isArray(parsed.filesToTouch) ? parsed.filesToTouch : [];
    return {
      plan: {
        steps: parsed.steps,
        filesToTouch,
        summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
      },
      cleaned: text.replace(PLAN_RE, '').trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Whether a plan describes work with no side effects, and so has nothing worth
 * approving.
 *
 * The gate exists to get consent BEFORE something is written, run or sent. A
 * pure lookup has no such moment: blocking it on approval buys the user
 * nothing and costs them the turn, because an unapproved plan just sits there
 * and the turn ends looking like the model ignored its tools. That was firing
 * on roughly one ordinary ask in three on the in-process loop.
 *
 * `kind` is optional on PlanStep, so a step that omits it counts as NOT
 * read-only. That is the safe direction: the cost of being wrong here is one
 * unnecessary approval card, where the opposite mistake would silently
 * auto-approve a plan that deletes something.
 */
export function isReadOnlyPlan(plan: PlanPayload): boolean {
  if (!plan.steps.length) return false;
  if (plan.filesToTouch.length) return false;
  return plan.steps.every((s) => s.kind === 'read');
}

/**
 * Emit a plan event and await the user's decision. Throws if the job is
 * cancelled/times out (via failAllWaiters in job-store).
 */
export async function awaitPlanApproval(
  jobId: string,
  plan: PlanPayload,
): Promise<{ decision: 'approved' | 'rejected' | 'adjusted'; adjustment?: string }> {
  const planId = crypto.randomUUID();
  publishJobEvent(jobId, { type: 'plan', planId, plan });
  try {
    const conversationId = getJob(jobId)?.scope.conversationId ?? null;
    const summary = plan.summary?.trim() || `Plan with ${plan.steps.length} step(s) ready for review`;
    void notifyAllSubscribers({
      title: 'Approval needed',
      body: summary.slice(0, 200),
      url: conversationId ? `/jkai?c=${conversationId}` : '/jkai',
    }).catch((e) => console.warn('[jkai-pwa] approval push failed', e));
  } catch (e) {
    console.warn('[jkai-pwa] approval push failed', e);
  }
  const { awaitResponse } = createWaiter<{ decision: 'approved' | 'rejected' | 'adjusted'; adjustment?: string }>(
    jobId,
    `plan:${planId}`,
  );
  return awaitResponse();
}
