import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: unknown[] = [];
const jobs = new Map<string, { scope: { conversationId: string | null; principalId?: string } }>();

vi.mock('$lib/server/push', () => ({
  notifyAllSubscribers: async (payload: unknown) => {
    sent.push(payload);
  },
}));
vi.mock('./job-store', () => ({
  getJob: (id: string) => jobs.get(id),
  jobPrincipal: (job: { scope: { principalId?: string } }) => job.scope.principalId ?? 'owner',
}));

const { notifyGate } = await import('./gate-notify');

beforeEach(() => {
  sent.length = 0;
  jobs.clear();
});

describe('notifyGate', () => {
  it('carries the ids a notification needs to answer the owner\'s turn', async () => {
    jobs.set('job-1', { scope: { conversationId: 'conv-1' } });
    notifyGate('job-1', { title: 'Confirmation needed', body: 'Send it?' }, { gate: 'confirm', confirmId: 'c-1' });
    await Promise.resolve();
    expect(sent).toEqual([
      {
        title: 'Confirmation needed',
        body: 'Send it?',
        url: '/jkai?c=conv-1',
        category: 'chat',
        data: { gate: 'confirm', confirmId: 'c-1', jobId: 'job-1', conversationId: 'conv-1' },
      },
    ]);
  });

  it('never tells the owner about a member\'s turn', async () => {
    jobs.set('job-2', { scope: { conversationId: 'conv-2', principalId: 'u_sam' } });
    notifyGate('job-2', { title: 'Approval needed', body: 'Plan' }, { gate: 'plan', planId: 'p-1' });
    await Promise.resolve();
    expect(sent).toEqual([]);
  });

  it('sends a plain alert when there is nothing to answer from the notification', async () => {
    jobs.set('job-3', { scope: { conversationId: null } });
    notifyGate('job-3', { title: 'Clarification needed', body: 'Two questions' }, null);
    await Promise.resolve();
    expect(sent).toMatchObject([{ url: '/jkai', data: undefined }]);
  });
});
