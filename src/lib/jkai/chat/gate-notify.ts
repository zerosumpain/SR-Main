import { getJob, jobPrincipal } from './job-store';
import { notifyAllSubscribers } from '$lib/server/push';

/**
 * Tell the owner a chat turn has stopped at a gate — and give the phone what
 * it needs to ANSWER it from the notification.
 *
 * The ids travel in `data`, which lands in the notification ledger beside the
 * alert. SR-Main's push dispatcher reads them (`data.gate` + `data.jobId`) and
 * sends an `sr.gate.<gate>` push whose buttons PATCH this app's
 * `/api/workflows/orchestrator/chat?jobId=` with the matching `_ack` — the same
 * call the chat screen makes.
 *
 * The OWNER's turns only. A member's turn stopping at a gate is theirs to
 * answer on their own screen; telling the owner would put the member's words
 * on his lock screen with a button that answers for them. The WhatsApp
 * escalation keeps the same rule.
 *
 * Never throws: the gate is already open and waiting, and a failed alert must
 * not fail the turn.
 */
export function notifyGate(
  jobId: string,
  alert: { title: string; body: string },
  /** Null: an alert that opens the chat, with nothing to answer from it. */
  gate: { gate: 'plan' | 'confirm' | 'clarify'; [id: string]: string } | null,
): void {
  try {
    const job = getJob(jobId);
    if (job && jobPrincipal(job) !== 'owner') return;
    const conversationId = job?.scope.conversationId ?? null;
    void notifyAllSubscribers({
      title: alert.title,
      body: alert.body.slice(0, 200),
      url: conversationId ? `/jkai?c=${conversationId}` : '/jkai',
      category: 'chat',
      data: gate ? { ...gate, jobId, ...(conversationId ? { conversationId } : {}) } : undefined,
    }).catch((e) => console.warn('[jkai] gate alert failed', e));
  } catch (e) {
    console.warn('[jkai] gate alert failed', e);
  }
}
