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
