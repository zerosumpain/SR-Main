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
    const res = await GET(makeEvent('missing'));
    expect(res.status).toBe(404);
  });
});
