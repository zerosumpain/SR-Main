import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GET /api/native/today — the `overnight` section: SR-Health's one-line read of
 * the Watch beside the strap, and its failure costs that tile alone.
 */

vi.mock('$lib/server/native-auth', () => ({
  identifyDevice: async () => ({ id: 'dev-1', ownerEmail: 'owner@example.com', expiresAt: new Date(Date.now() + 60000) }),
  touchDevice: async () => {},
}));
vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.com' } }));
vi.mock('$lib/server/native-health', () => ({ getNativeHealthSummary: async () => { throw new Error('health down'); } }));
let vitals: () => Promise<unknown> = async () => null;
vi.mock('$lib/server/extracted-app', () => ({ getFromExtracted: async () => ({ vitals: await vitals() }) }));
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

async function today({ fresh = false } = {}) {
  const mod = await import('../../../../src/routes/api/native/today/+server');
  const request = new Request(`http://x/api/native/today${fresh ? '?fresh=1' : ''}`, { headers: { Authorization: 'Bearer t' } });
  const res = await (mod.GET as (e: unknown) => Promise<Response>)({ locals: {}, request, url: new URL(request.url), params: {} });
  return { status: res.status, body: await res.json() };
}

const section = {
  note: 'n',
  headline: 'SpO₂ apart last night',
  brief: 'SpO₂ 96.4 · 92.6%',
  tone: 'watch',
  rows: [],
};

beforeEach(async () => {
  notes = async () => [note];
  vitals = async () => section;
});

describe('GET /api/native/today — overnight', () => {
  it('carries the headline, the brief and the tone, and nothing to chart', async () => {
    const { body } = await today();
    expect(body.overnight).toEqual({ headline: 'SpO₂ apart last night', brief: 'SpO₂ 96.4 · 92.6%', tone: 'watch' });
  });

  it('is null when SR-Health has no reading, or fails', async () => {
    vitals = async () => null;
    expect((await today({ fresh: true })).body.overnight).toBeNull();
    vitals = async () => { throw new Error('health down'); };
    const { status, body } = await today({ fresh: true });
    expect(status).toBe(200);
    expect(body.overnight).toBeNull();
    expect(body.daydream).toEqual({ notes: [note] });
  });
});
