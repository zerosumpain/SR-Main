import { ownerPhone } from '$lib/config/owner';
import { getJob, getStreamSubscriberCount, registerEventHook, type JobEvent } from './job-store';
import { isUserPresent } from './presence';
import { getWhatsAppService } from '$lib/workflows/whatsapp/service';

const OWNER_PHONE = ownerPhone() ?? '';
const SITE_URL = 'https://strangeramblings.com';
const GRACE_MS = 15_000;
// A *finished* reply (done/error) only earns a WhatsApp ping if it actually
// took a while to generate — a quick reply you were watching doesn't warrant
// interrupting your phone. Blocked-on-you waiters (plan/clarify/confirm) are
// exempt from this: they ping as soon as the user is away, however fast they
// arrived, because the run is stalled until you act.
const LONG_REPLY_MS = 3 * 60_000; // 3 min

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
    // No `state.status` gate. In delegated mode that value is set ONCE by a probe
    // at boot and never re-probed, so any VPS restart during an outage — a CI
    // deploy counts — pinned this channel off permanently, even after homeserv
    // came back. Attempt the send and report what actually happened.
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
    // Presence gate — skip the ping if the owner is actively viewing this
    // conversation. Two independent signals, either of which suffices:
    //  - an open SSE subscriber: true while a job is mid-flight (e.g. a waiter),
    //    but gone the instant a terminal done/error closes the stream;
    //  - a recent presence heartbeat from the /jkai tab: the only signal that
    //    survives completion, so it's what actually gates the "finished" ping.
    if (getStreamSubscriberCount(jobId) > 0 || isUserPresent(conversationId)) return;
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
    case 'done': {
      cancelPending(jobId);
      // Only ping on a finished reply if it was genuinely slow to generate.
      const elapsedMs = job ? Date.now() - job.startedAt : 0;
      if (elapsedMs >= LONG_REPLY_MS) {
        schedule(jobId, 'terminal', `${summariseDone()}\n\n${deepLink(conversationId)}`, conversationId);
      }
      setTimeout(() => sent.delete(jobId), 5 * 60_000);
      return;
    }
    case 'error': {
      cancelPending(jobId);
      const elapsedMs = job ? Date.now() - job.startedAt : 0;
      if (elapsedMs >= LONG_REPLY_MS) {
        schedule(jobId, 'terminal', `${summariseError(event)}\n\n${deepLink(conversationId)}`, conversationId);
      }
      setTimeout(() => sent.delete(jobId), 5 * 60_000);
      return;
    }
  }
}

let registered = false;
export function installWaEscalation(): void {
  if (registered) return;
  registered = true;
  registerEventHook(handleEvent);
  console.log('[wa-escalation] installed');
}
