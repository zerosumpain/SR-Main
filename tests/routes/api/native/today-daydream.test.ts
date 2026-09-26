import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/native/today — the `daydream` section. It carries the Noticed
 * card's notes, and its failure costs that card alone, like every section.
 */

vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => ({ id: 'dev-1', ownerEmail: 'owner@example.com' }),
  touchDevice: async () => {},
}));
vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.com' } }));
vi.mock('$lib/server/native-health', () => ({ getNativeHealthSummary: async () => { throw new Error('health down'); } }));
vi.mock('$lib/server/notify', () => ({ pendingForDevice: async () => [], recentEvents: async () => [] }));
vi.mock('$lib/news/desk', () => ({ loadNewsDesk: async () => { throw new Error('news down'); } }));
vi.mock('$lib/connectors/watch-store', () => ({ connectorAttention: async () => ({ items: [], checkedAt: null }) }));
vi.mock('$lib/db/schema', () => ({ conversations: { id: 'id', title: 'title', updatedAt: 'updatedAt', principalId: 'principalId' } }));
vi.mock('$lib/db', () => {
  const chain = { select: () => chain, from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => [] };
  return { db: chain };
});

const note = {
  id: 't-1',
  outcome: 'correlate',
  channel: 'chat',
  title: 'Late screens cost you deep sleep',
  body: 'Deep sleep averaged 52 min against 71.',
  createdAt: '2026-09-25T16:00:00.000Z',
  url: '/jkai/daydreams?note=t-1',
  feedback: null,
};
let notes: () => Promise<unknown[]> = async () => [note];
vi.mock('$lib/daydream/think/notes.server', () => ({ loadTodayNotes: () => notes() }));

async function today() {
  const mod = await import('../../../../src/routes/api/native/today/+server');
  const request = new Request('http://x/api/native/today', { headers: { Authorization: 'Bearer t' } });
  const res = await (mod.GET as (e: unknown) => Promise<Response>)({ request, url: new URL(request.url), params: {} });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  notes = async () => [note];
});

describe('GET /api/native/today — daydream', () => {
  it('carries { notes } beside the other sections', async () => {
    const { status, body } = await today();
    expect(status).toBe(200);
    expect(body.daydream).toEqual({ notes: [note] });
    // Other sections failing did not take this one with them.
    expect(body.health).toBeNull();
    expect(body.news).toBeNull();
  });

  it('a failure drops only the daydream section', async () => {
    notes = async () => {
      throw new Error('ledger down');
    };
    const { status, body } = await today();
    expect(status).toBe(200);
    expect(body.daydream).toBeNull();
    expect(body.alerts).toEqual({ pending: 0, unread: 0, latest: [] });
  });
});
