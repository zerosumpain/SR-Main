import { describe, it, expect, vi, beforeEach } from 'vitest';

let sessionRows: any[] = [{ id: 'sess-1', report: { executive_summary: 'hi', clusters: [], ranked_facts: [], timeline: [], entity_centrality: {} } }];

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => sessionRows }),
      }),
    }),
  },
}));

vi.mock('$lib/db/schema', () => ({ researchSessions: { id: {}, report: {} } }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));

// The access guard is covered by its own tests; here it resolves the row the
// test provides as the owner, and 404s (throws) exactly as the guard does.
vi.mock('$lib/deepdive/session-access.server', async () => {
  const { error } = await import('@sveltejs/kit');
  return {
    requireResearchSession: vi.fn(async () => {
      if (!sessionRows.length) throw error(404, 'Session not found');
      return { session: sessionRows[0], access: { level: 'owner', own: 'owner' } };
    }),
  };
});

import { GET } from './+server';

const makeEvent = (id: string) => ({ params: { id } }) as any;

beforeEach(() => {
  sessionRows = [{ id: 'sess-1', report: { executive_summary: 'hi', clusters: [], ranked_facts: [], timeline: [], entity_centrality: {} } }];
});

describe('GET /api/deepdive/[id]/report', () => {
  it('returns { report } when the session has a report', async () => {
    const res = await GET(makeEvent('sess-1'));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.report.executive_summary).toBe('hi');
  });

  it('returns { report: null } when report is null', async () => {
    sessionRows = [{ id: 'sess-1', report: null }];
    const res = await GET(makeEvent('sess-1'));
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.report).toBeNull();
  });

  it('404s when the session does not exist', async () => {
    sessionRows = [];
    await expect(GET(makeEvent('missing'))).rejects.toMatchObject({ status: 404 });
  });
});
