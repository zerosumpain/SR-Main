import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('../push-devices', () => ({ pushToOwner: async () => ({ reached: new Set(), sent: 0, failed: 0, muted: 0 }) }));

const { messageFor, tierFor } = await import('./push-dispatch');

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

describe('which level hears a ledger row', () => {
  it('an alert or a lapsed connection reaches every level, a warning needs Normal, information needs Verbose', () => {
    expect(tierFor('alert')).toBe('minimal');
    expect(tierFor('info', true)).toBe('minimal');
    expect(tierFor('warn')).toBe('normal');
    expect(tierFor('info')).toBe('verbose');
    expect(messageFor(row({ category: 'daydream', severity: 'info' })).tier).toBe('verbose');
    expect(messageFor(row({ category: 'connections', severity: 'info' })).tier).toBe('minimal');
  });
  it('a stalled chat gate reaches every level; a finished reply needs Normal', () => {
    expect(messageFor(row({ data: { gate: 'confirm', jobId: 'j1', confirmId: 'c1', effect: 'mutate' } })).tier).toBe('minimal');
    expect(messageFor(row({ data: { gate: 'confirm', jobId: 'j1', confirmId: 'c1' } })).tier).toBe('minimal');
    expect(messageFor(row({ data: { kind: 'reply', conversationId: 'conv-9' } })).tier).toBe('normal');
  });
});

describe('messageFor', () => {
  it('groups a reply-ready push per thread, with no buttons (slice 8)', () => {
    const m = messageFor(row({ title: 'jkai replied', body: 'Your answer is ready.', data: { kind: 'reply', conversationId: 'conv-9', budget: 'sent' } }));
    expect(m.category).toBe('sr.alert');
    expect(m.threadId).toBe('chat:conv-9');
    expect(m.userInfo).toMatchObject({ conversationId: 'conv-9', category: 'chat' });
    expect(m.userInfo?.gate).toBeUndefined();
    const stopped = messageFor(row({ title: 'That turn stopped', data: { kind: 'stopped', conversationId: 'conv-9' } }));
    expect(stopped.threadId).toBe('chat:conv-9');
  });
  it('carries a commissioned build and its links, grouped by build (slice 6b)', () => {
    const m = messageFor(row({ category: 'build', title: 'Pull request needs you', url: '/jkai/develop/b1',
      data: { kind: 'delivery', buildId: 'b1', prUrl: 'https://github.com/x/pull/9', previewUrl: 'https://p.example', conversationId: 'conv-1', budget: 'sent' } }));
    expect(m.userInfo).toMatchObject({ buildId: 'b1', prUrl: 'https://github.com/x/pull/9', previewUrl: 'https://p.example', conversationId: 'conv-1', url: '/jkai/develop/b1' });
    expect(m.threadId).toBe('delivery:b1');
    expect(m.category).toBe('sr.alert');
  });
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
  describe('drive: attachments filed from mail (build map §2.5)', () => {
    const drive = (extra: Record<string, unknown> = {}) => row({
      category: 'drive', title: 'Saved invoice.pdf', body: 'From HMRC: Your statement.',
      url: 'sr://drive?space=mine&folder=Mail%2Fimportant%2Fhmrc-gov-uk%2F2026-11&file=f-1',
      data: { kind: 'mail-attachments', fileIds: ['f-1'], folder: 'Mail/important/hmrc-gov-uk/2026-11', space: 'mine',
        ruleId: 'important', gmailMessageId: 'm1', gmailThreadId: 't1', webUrl: '/drive?path=x&file=f-1' },
      ...extra,
    });

    it('wears sr.alert, groups under one drive thread, and routes on the url', () => {
      const m = messageFor(drive());
      expect(m.category).toBe('sr.alert');
      expect(m.threadId).toBe('drive');
      expect(m.collapseId).toBe(row().id);
      expect(m.level).toBe('passive');
      expect(m.userInfo).toEqual({
        id: row().id, category: 'drive',
        url: 'sr://drive?space=mine&folder=Mail%2Fimportant%2Fhmrc-gov-uk%2F2026-11&file=f-1',
        fileId: 'f-1', folder: 'Mail/important/hmrc-gov-uk/2026-11',
      });
      // Nothing of the mail itself rides in userInfo.
      expect(JSON.stringify(m.userInfo)).not.toMatch(/gmail|m1|t1|ruleId/);
    });

    it('is active only at alert severity; a warn (action needed) stays passive', () => {
      expect(messageFor(drive({ severity: 'warn' })).level).toBe('passive');
      expect(messageFor(drive({ severity: 'alert' })).level).toBe('active');
    });

    it('names no single file for a several-file email or a roll-up', () => {
      const m = messageFor(drive({ url: 'sr://drive?space=mine&folder=Mail', data: { kind: 'mail-attachments', fileIds: ['a', 'b'], folder: 'Mail' } }));
      expect(m.userInfo?.fileId).toBeUndefined();
      expect(m.userInfo).toMatchObject({ folder: 'Mail', url: 'sr://drive?space=mine&folder=Mail' });
      expect(messageFor(drive({ data: null })).userInfo).toEqual({ id: row().id, category: 'drive', url: drive().url });
    });
  });
});
