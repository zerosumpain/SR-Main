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
  it('turns a chat gate into an answerable, time-sensitive push carrying its ids', () => {
    const m = messageFor(row({ data: { gate: 'confirm', jobId: 'job-1', confirmId: 'c-1', conversationId: 'conv-1' } }));
    expect(m.category).toBe('sr.gate.confirm');
    expect(m.level).toBe('time-sensitive');
    expect(m.userInfo).toMatchObject({ gate: 'confirm', jobId: 'job-1', confirmId: 'c-1', conversationId: 'conv-1', category: 'chat' });
    expect(m.collapseId).toBe(row().id);
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
