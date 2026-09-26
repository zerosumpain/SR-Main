// wa-escalation pings the OWNER's phone. A member's turn must never reach it —
// not its plan, not its question, not its finished reply.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMessage = vi.fn(async (_to: string, _text: string) => ({ sent: true as const }));

vi.mock('$lib/workflows/whatsapp/service', () => ({
  getWhatsAppService: () => ({ sendMessage }),
}));
vi.mock('$lib/config/owner', () => ({ ownerPhone: () => '+440000000000' }));

import { installWaEscalation } from './wa-escalation';
import { createJob, createWaiter, publishJobEvent, cancelJob, cleanOldJobs } from './job-store';

const PLAN = {
  type: 'plan' as const,
  planId: 'p1',
  plan: { steps: [{ id: 's1', title: 'Look it up', detail: 'search' }], filesToTouch: [], summary: 'Look it up' },
};

beforeEach(() => {
  vi.useFakeTimers();
  sendMessage.mockClear();
  installWaEscalation();
});

afterEach(() => {
  cleanOldJobs(0);
  vi.useRealTimers();
});

describe('wa-escalation — only the owner is escalated to', () => {
  it("pings for the owner's open plan once the grace period passes", async () => {
    const { jobId } = createJob('owner turn', { conversationId: 'wa-owner' });
    // Cancelling at the end rejects the waiter; nobody is awaiting it here.
    void createWaiter(jobId, 'plan:p1').awaitResponse().catch(() => {});
    publishJobEvent(jobId, PLAN);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    cancelJob(jobId);
  });

  it("never pings for a member's plan or finished reply", async () => {
    const { jobId } = createJob('member turn', { conversationId: 'wa-member', principalId: 'u_a' });
    // Cancelling at the end rejects the waiter; nobody is awaiting it here.
    void createWaiter(jobId, 'plan:p1').awaitResponse().catch(() => {});
    publishJobEvent(jobId, PLAN);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(sendMessage).not.toHaveBeenCalled();

    // A slow reply — past the three-minute threshold that earns the owner a ping.
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    publishJobEvent(jobId, { type: 'done', result: { success: true } });
    await vi.advanceTimersByTimeAsync(16_000);
    expect(sendMessage).not.toHaveBeenCalled();
    cancelJob(jobId);
  });
});
