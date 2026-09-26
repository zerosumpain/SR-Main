import { describe, it, expect, vi, beforeEach } from 'vitest';

const runPostProcessingCalls: Array<{ sessionId: string; session: any }> = [];

vi.mock('$lib/deepdive/postprocess', () => ({
  runPostProcessing: vi.fn(async (sessionId: string, session: any) => {
    runPostProcessingCalls.push({ sessionId, session });
  }),
}));

let sessionRows: any[] = [{ id: 'sess-1', topic: 'T', goals: ['g'], report: null }];

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => sessionRows }),
      }),
    }),
  },
}));

vi.mock('$lib/db/schema', () => ({ researchSessions: { id: {} } }));
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
    // The owner is never metered.
    reserveResearchStart: vi.fn(async () => {}),
  };
});

import { POST } from './+server';
import { runPostProcessing } from '$lib/deepdive/postprocess';

const makeEvent = (id: string) => ({ params: { id } }) as any;

beforeEach(() => {
  runPostProcessingCalls.length = 0;
  (runPostProcessing as any).mockClear();
  sessionRows = [{ id: 'sess-1', topic: 'T', goals: ['g'], report: null }];
});

describe('POST /api/deepdive/[id]/report/regenerate', () => {
  it('returns 202 { ok:true } and fires runPostProcessing with the full session row', async () => {
    const res = await POST(makeEvent('sess-1'));
    expect(res.status).toBe(202);
    const payload = await res.json();
    expect(payload).toEqual({ ok: true });

    // fire-and-forget: kicked off synchronously before the response resolves
    expect(runPostProcessingCalls).toHaveLength(1);
    expect(runPostProcessingCalls[0].sessionId).toBe('sess-1');
    expect(runPostProcessingCalls[0].session).toMatchObject({ id: 'sess-1', topic: 'T' });
  });

  it('404s when the session does not exist (no kickoff)', async () => {
    sessionRows = [];
    await expect(POST(makeEvent('missing'))).rejects.toMatchObject({ status: 404 });
    expect(runPostProcessingCalls).toHaveLength(0);
  });
});
