import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('../push-devices', () => ({ pushToOwner: async () => ({ reached: new Set(), sent: 0, failed: 0 }) }));

const { messageFor } = await import('./push-dispatch');

const row = (extra: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  category: 'chat',
  title: 'Confirmation needed',
  body: 'Send email to sam@example.test?',
  url: '/jkai?c=conv-1',
  severity: 'info',
  data: null,
  ...extra,
});

describe('messageFor', () => {
  it('groups commission milestones without collapsing distinct events', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const m = messageFor(row({ category: 'daydream', data: { schemaVersion: 1, destination: 'daydream_commission', commissionId: id } }));
    expect(m.userInfo?.commissionId).toBe(id);
    expect(m.threadId).toBe(`commission:${id}`);
    expect(m.collapseId).toBe(row().id);
    expect(m.category).toBe('sr.alert');
  });
  it('turns a plan gate into an answerable, time-sensitive push carrying its ids', () => {
    const m = messageFor(row({ title: 'Approval needed', data: { gate: 'plan', jobId: 'job-1', planId: 'p-1', conversationId: 'conv-1' } }));
    expect(m.category).toBe('sr.gate.plan');
    expect(m.level).toBe('time-sensitive');
    expect(m.userInfo).toMatchObject({ gate: 'plan', jobId: 'job-1', planId: 'p-1', conversationId: 'conv-1', category: 'chat' });
    expect(m.collapseId).toBe(row().id);
  });

  it('keeps the reply field on a clarify gate', () => {
    const m = messageFor(row({ data: { gate: 'clarify', jobId: 'job-1', clarifyId: 'q', questionId: 'q1' } }));
    expect(m.category).toBe('sr.gate.clarify');
  });

  describe('view-only confirms (decision 1: answer on the website)', () => {
    const confirm = { gate: 'confirm', jobId: 'job-1', confirmId: 'c-1', conversationId: 'conv-1' };
    const expectViewOnly = (m: ReturnType<typeof messageFor>) => {
      // No category with an Approve action, and nothing an app could answer with.
      expect(m.category).toBe('sr.alert');
      expect((m.category ?? '').startsWith('sr.gate.')).toBe(false);
      for (const key of ['gate', 'jobId', 'confirmId', 'planId']) expect(m.userInfo).not.toHaveProperty(key);
      expect(m.body.startsWith('Answer this on the website.')).toBe(true);
      expect(m.userInfo).toMatchObject({ id: row().id, category: 'chat', url: '/jkai?c=conv-1', conversationId: 'conv-1', viewOnly: '1' });
      expect(m.level).toBe('time-sensitive');
    };

    it('a destructive confirm has no Approve action', () => {
      expectViewOnly(messageFor(row({ data: { ...confirm, effect: 'destructive' } })));
    });

    it('a confirm that does not say what it is fails closed to view-only (every confirm today)', () => {
      expectViewOnly(messageFor(row({ data: confirm })));
    });

    it('a commission confirm has no Approve action, even if it calls itself a light one', () => {
      expectViewOnly(messageFor(row({ data: { ...confirm, lane: 'commission', effect: 'mutates' } })));
    });

    it('a commission-lane plan gate is view-only too', () => {
      expectViewOnly(messageFor(row({ data: { gate: 'plan', jobId: 'job-1', planId: 'p-1', conversationId: 'conv-1', lane: 'commission' } })));
    });

    it('a light mutates confirm keeps its buttons', () => {
      const m = messageFor(row({ data: { ...confirm, effect: 'mutates' } }));
      expect(m.category).toBe('sr.gate.confirm');
      expect(m.userInfo).toMatchObject({ gate: 'confirm', confirmId: 'c-1' });
    });
  });

  it('treats a gate without a job as an ordinary alert: nothing to answer it with', () => {
    expect(messageFor(row({ data: { gate: 'confirm' } })).category).toBe('sr.alert');
  });

  it('grades everything else like the app grades its local alerts', () => {
    expect(messageFor(row({ category: 'news' })).level).toBe('passive');
    expect(messageFor(row({ category: 'deploy', severity: 'alert' })).level).toBe('active');
    const c = messageFor(row({ category: 'connections' }));
    expect(c.category).toBe('sr.connections');
    expect(c.level).toBe('active');
  });

  it('carries the ledger id and category so a tap and "Mark read" still work', () => {
    expect(messageFor(row({ category: 'health' })).userInfo).toEqual({ id: row().id, category: 'health', url: '/jkai?c=conv-1' });
  });
});
