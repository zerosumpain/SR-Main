import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks must be declared before importing the handler under test. ---

const insertedRows: any[] = [];
const runSynthesisCalls: Array<{ sessionId: string; runId: string; scope: any }> = [];

// Stub the synthesis worker so no LLM/DB writes happen on kickoff.
vi.mock('$lib/deepdive/synthesis', () => ({
  runSynthesis: vi.fn(async (sessionId: string, runId: string, scope: any) => {
    runSynthesisCalls.push({ sessionId, runId, scope });
  }),
}));

// Configurable: does the session lookup return a row?
let sessionExists = true;

vi.mock('$lib/db', () => {
  const db = {
    // session lookup: db.select(...).from(...).where(...) -> array
    select: () => ({
      from: () => ({
        where: async () => (sessionExists ? [{ id: 'sess-1' }] : []),
      }),
    }),
    // run insert: db.insert(...).values(...).returning(...) -> [{ id }]
    insert: () => ({
      values: (vals: any) => ({
        returning: async () => {
          const row = { id: 'run-123', ...vals };
          insertedRows.push(row);
          return [{ id: row.id }];
        },
      }),
    }),
  };
  return { db };
});

import { POST } from './+server';

function makeEvent(id: string, body: unknown) {
  return {
    params: { id },
    request: { json: async () => body },
  } as any;
}

beforeEach(() => {
  insertedRows.length = 0;
  runSynthesisCalls.length = 0;
  sessionExists = true;
});

describe('POST /api/deepdive/[id]/synthesize', () => {
  it('inserts a synthesis_runs row and returns 201 { runId }', async () => {
    const res = await POST(makeEvent('sess-1', { scope: { pinnedOnly: true } }));
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.runId).toBe('run-123');

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].sessionId).toBe('sess-1');
    expect(insertedRows[0].status).toBe('running');
    expect(insertedRows[0].scope).toEqual({ pinnedOnly: true });
  });

  it('kicks runSynthesis fire-and-forget with the resolved scope', async () => {
    await POST(makeEvent('sess-1', { scope: { factIds: ['f1', 'f2'] } }));
    expect(runSynthesisCalls).toHaveLength(1);
    expect(runSynthesisCalls[0]).toEqual({
      sessionId: 'sess-1',
      runId: 'run-123',
      scope: { factIds: ['f1', 'f2'] },
    });
  });

  it('whitelists scope fields — drops unknown keys and non-string factIds', async () => {
    await POST(makeEvent('sess-1', { scope: { factIds: ['ok', 7, null], evil: 'x', category: 'C' } }));
    expect(insertedRows[0].scope).toEqual({ factIds: ['ok'], category: 'C' });
  });

  it('defaults to empty scope when body has none', async () => {
    await POST(makeEvent('sess-1', {}));
    expect(insertedRows[0].scope).toEqual({});
  });

  it('404s when the session does not exist (no insert, no kickoff)', async () => {
    sessionExists = false;
    const res = await POST(makeEvent('missing', { scope: {} }));
    expect(res.status).toBe(404);
    expect(insertedRows).toHaveLength(0);
    expect(runSynthesisCalls).toHaveLength(0);
  });
});
