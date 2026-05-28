import { getJob, getStreamSubscriberCount, registerEventHook, type JobEvent } from './job-store';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';

const OWNER_PHONE = '+447359228511';
const SITE_URL = 'https://strangeramblings.com';
const GRACE_MS = 15_000;

interface PendingEscalation {
  kind: 'waiter' | 'terminal';
  body: string;
  conversationId: string | null;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingEscalation>();
const sent = new Map<string, Set<'waiter' | 'terminal'>>();

function summarisePlan(event: Extract<JobEvent, { type: 'plan' }>): string {
  const summary = event.plan.summary?.trim();
  if (summary) return summary.slice(0, 200);
  const first = event.plan.steps[0];
  if (first) return `Plan with ${event.plan.steps.length} step(s) starting "${first}"`.slice(0, 200);
  return 'Plan ready for approval';
}

function summariseClarify(event: Extract<JobEvent, { type: 'clarify' }>): string {
  const first = event.questions[0]?.text ?? '';
  const extra = event.questions.length > 1 ? ` (+${event.questions.length - 1} more)` : '';
  return `"${first}"${extra}`.slice(0, 200);
}

function summariseConfirm(event: Extract<JobEvent, { type: 'confirm' }>): string {
  return event.prompt.slice(0, 200);
}

function summariseDone(): string {
  return 'JKAI finished what you asked.';
}

function summariseError(event: Extract<JobEvent, { type: 'error' }>): string {
  return `JKAI hit an error: ${event.message.slice(0, 160)}`;
}

function deepLink(conversationId: string | null): string {
  return conversationId
    ? `${SITE_URL}/jkai?c=${conversationId}`
    : `${SITE_URL}/jkai`;
}

function buildWaiterMessage(label: string, body: string, conversationId: string | null): string {
  return `JKAI ${label}: ${body}\n\n${deepLink(conversationId)}`;
}

async function sendWa(text: string): Promise<void> {
  try {
    const wa = getWhatsAppService();
    const state = wa.getState();
    if (state.status !== 'connected') {
      console.warn('[wa-escalation] WhatsApp not connected — skipping ping');
      return;
    }
    const result = await wa.sendMessage(OWNER_PHONE, text);
    if (!result.sent) console.error(`[wa-escalation] send failed: ${result.error}`);
  } catch (err) {
    console.error('[wa-escalation] send threw:', err);
  }
}

function schedule(
  jobId: string,
  kind: 'waiter' | 'terminal',
  body: string,
  conversationId: string | null,
): void {
  const already = sent.get(jobId);
  if (already?.has(kind)) return;
  const existing = pending.get(jobId);
  if (existing && existing.kind === kind) return;
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    pending.delete(jobId);
    const subs = getStreamSubscriberCount(jobId);
    if (subs > 0) return;
    if (kind === 'waiter') {
      const job = getJob(jobId);
      if (!job || job.waiterOpenedAt == null) return;
    }
    const set = sent.get(jobId) ?? new Set<'waiter' | 'terminal'>();
    set.add(kind);
    sent.set(jobId, set);
    void sendWa(body);
  }, GRACE_MS);

  pending.set(jobId, { kind, body, conversationId, timer });
}

function cancelPending(jobId: string): void {
  const existing = pending.get(jobId);
  if (!existing) return;
  clearTimeout(existing.timer);
  pending.delete(jobId);
}

function handleEvent(jobId: string, event: JobEvent): void {
  const job = getJob(jobId);
  const conversationId = job?.scope.conversationId ?? null;

  switch (event.type) {
    case 'plan':
      schedule(jobId, 'waiter', buildWaiterMessage('is asking for approval', summarisePlan(event), conversationId), conversationId);
      return;
    case 'clarify':
      schedule(jobId, 'waiter', buildWaiterMessage('needs clarification', summariseClarify(event), conversationId), conversationId);
      return;
    case 'confirm':
      schedule(jobId, 'waiter', buildWaiterMessage('needs confirmation', summariseConfirm(event), conversationId), conversationId);
      return;
    case 'done':
      cancelPending(jobId);
      schedule(jobId, 'terminal', `${summariseDone()}\n\n${deepLink(conversationId)}`, conversationId);
      setTimeout(() => sent.delete(jobId), 5 * 60_000);
      return;
    case 'error':
      cancelPending(jobId);
      schedule(jobId, 'terminal', `${summariseError(event)}\n\n${deepLink(conversationId)}`, conversationId);
      setTimeout(() => sent.delete(jobId), 5 * 60_000);
      return;
  }
}

let registered = false;
export function installWaEscalation(): void {
  if (registered) return;
  registered = true;
  registerEventHook(handleEvent);
  console.log('[wa-escalation] installed');
}
