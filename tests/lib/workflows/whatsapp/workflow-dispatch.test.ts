import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — keep the dispatch module isolated from the real DB + engine barrel.
// ---------------------------------------------------------------------------

// Distinct table markers so the db mock can branch on which table is queried.
vi.mock('$lib/db/schema', () => ({
  workflows: { __t: 'workflows' },
  workflowNodes: { __t: 'workflowNodes' },
  workflowEdges: { __t: 'workflowEdges' },
  workflowRuns: { __t: 'workflowRuns' },
}));

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

// The owner's number drives the owner-digit comparison. Stub it so
// the real approval-notify import chain (db, run-notifications, tokens) stays
// out of this unit test.
vi.mock('$lib/workflows/whatsapp/approval-notify', () => ({ getOwnerPhone: () => '+447359228511' }));

const mockEngineExecute = vi.fn().mockResolvedValue({ status: 'completed', output: {}, error: null });
vi.mock('$lib/workflows', () => ({ engine: { execute: (...a: unknown[]) => mockEngineExecute(...a) } }));

// Mutable state the tests drive.
const mockState = {
  triggerNodes: [] as Array<Record<string, unknown>>,
  workflowsQueue: [] as Array<Array<{ id: string; name: string }>>,
};

vi.mock('$lib/db', () => {
  function whereResult(table: { __t: string }) {
    const all =
      table.__t === 'workflowNodes'
        ? mockState.triggerNodes
        : []; // workflowEdges / workflows base result (workflows uses .limit)
    const p = Promise.resolve(all) as Promise<unknown> & { limit: (n?: number) => Promise<unknown> };
    p.limit = () =>
      Promise.resolve(table.__t === 'workflows' ? mockState.workflowsQueue.shift() ?? [] : []);
    return p;
  }
  const selectBuilder = () => {
    let table: { __t: string } = { __t: 'unknown' };
    const builder = {
      from(t: { __t: string }) {
        table = t;
        return builder;
      },
      where: () => whereResult(table),
    };
    return builder;
  };
  return {
    db: {
      select: () => selectBuilder(),
      insert: () => ({ values: () => Promise.resolve() }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    },
  };
});

import {
  matchWhatsAppKeyword,
  isReservedKeyword,
  isOwnerSender,
  findMatchingWhatsAppWorkflows,
  dispatchWhatsAppWorkflow,
  WA_RESERVED_KEYWORDS,
} from '$lib/workflows/whatsapp/workflow-dispatch';

const OWNER = '447359228511';
const NON_OWNER = '19998887777';

beforeEach(() => {
  vi.clearAllMocks();
  mockState.triggerNodes = [];
  mockState.workflowsQueue = [];
  mockEngineExecute.mockResolvedValue({ status: 'completed', output: {}, error: null });
});

// ---------------------------------------------------------------------------
// Pure matching matrix
// ---------------------------------------------------------------------------

describe('matchWhatsAppKeyword — matching matrix', () => {
  it('prefix: matches keyword alone and keyword + text, strips by default', () => {
    expect(matchWhatsAppKeyword('news', 'news', 'prefix', true)).toEqual({ matched: true, stripped: '' });
    expect(matchWhatsAppKeyword('news bitcoin', 'news', 'prefix', true)).toEqual({
      matched: true,
      stripped: 'bitcoin',
    });
  });

  it('prefix: is case-insensitive and preserves remainder case', () => {
    expect(matchWhatsAppKeyword('NEWS Bitcoin', 'news', 'prefix', true)).toEqual({
      matched: true,
      stripped: 'Bitcoin',
    });
  });

  it('prefix: respects a word boundary (newsflash does NOT match news)', () => {
    expect(matchWhatsAppKeyword('newsflash today', 'news', 'prefix', true).matched).toBe(false);
  });

  it('prefix: stripKeyword=false forwards the full trimmed message', () => {
    expect(matchWhatsAppKeyword('  news bitcoin  ', 'news', 'prefix', false)).toEqual({
      matched: true,
      stripped: 'news bitcoin',
    });
  });

  it('exact: matches only the keyword alone', () => {
    expect(matchWhatsAppKeyword('digest', 'digest', 'exact', true)).toEqual({ matched: true, stripped: '' });
    expect(matchWhatsAppKeyword('digest please', 'digest', 'exact', true).matched).toBe(false);
  });

  it('exact: stripKeyword=false forwards the keyword itself', () => {
    expect(matchWhatsAppKeyword('digest', 'digest', 'exact', false)).toEqual({
      matched: true,
      stripped: 'digest',
    });
  });

  it('contains: matches anywhere and strips the first occurrence', () => {
    expect(matchWhatsAppKeyword('please note this', 'note', 'contains', true)).toEqual({
      matched: true,
      stripped: 'please this',
    });
    expect(matchWhatsAppKeyword('nothing here', 'note', 'contains', true).matched).toBe(false);
  });

  it('empty keyword never matches', () => {
    expect(matchWhatsAppKeyword('anything', '', 'prefix', true).matched).toBe(false);
  });
});

describe('reserved words + owner helpers', () => {
  it('flags approve/deny/yes/no (case-insensitive) as reserved', () => {
    for (const w of ['approve', 'DENY', 'Yes', 'no']) expect(isReservedKeyword(w)).toBe(true);
    expect(isReservedKeyword('news')).toBe(false);
    expect([...WA_RESERVED_KEYWORDS].sort()).toEqual(['approve', 'deny', 'no', 'yes']);
  });

  it('owner comparison is digit-normalised', () => {
    expect(isOwnerSender('447359228511')).toBe(true);
    expect(isOwnerSender('+44 7359 228511')).toBe(true);
    expect(isOwnerSender('447359228511@s.whatsapp.net')).toBe(true);
    expect(isOwnerSender(NON_OWNER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findMatchingWhatsAppWorkflows — DB-backed matching
// ---------------------------------------------------------------------------

describe('findMatchingWhatsAppWorkflows', () => {
  it('returns a match with the stripped message for a matching keyword', async () => {
    mockState.triggerNodes = [{ id: 'n1', workflowId: 'wf1', config: { keyword: 'news' } }];
    mockState.workflowsQueue = [[{ id: 'wf1', name: 'News Digest' }]];

    const matches = await findMatchingWhatsAppWorkflows('news bitcoin');
    expect(matches).toEqual([
      { workflowId: 'wf1', workflowName: 'News Digest', keyword: 'news', stripped: 'bitcoin' },
    ]);
  });

  it('skips reserved-keyword triggers (approval flow owns them)', async () => {
    mockState.triggerNodes = [{ id: 'n1', workflowId: 'wf1', config: { keyword: 'yes' } }];
    mockState.workflowsQueue = [[{ id: 'wf1', name: 'Should Not Match' }]];

    const matches = await findMatchingWhatsAppWorkflows('yes please');
    expect(matches).toEqual([]);
  });

  it('honours matchMode + stripKeyword from config', async () => {
    mockState.triggerNodes = [
      { id: 'n1', workflowId: 'wf1', config: { keyword: 'digest', matchMode: 'exact', stripKeyword: false } },
    ];
    mockState.workflowsQueue = [[{ id: 'wf1', name: 'Exact Digest' }]];

    const matches = await findMatchingWhatsAppWorkflows('digest');
    expect(matches).toEqual([
      { workflowId: 'wf1', workflowName: 'Exact Digest', keyword: 'digest', stripped: 'digest' },
    ]);
  });

  it('returns [] when nothing matches', async () => {
    mockState.triggerNodes = [{ id: 'n1', workflowId: 'wf1', config: { keyword: 'news' } }];
    const matches = await findMatchingWhatsAppWorkflows('weather today');
    expect(matches).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// dispatchWhatsAppWorkflow — orchestration
// ---------------------------------------------------------------------------

describe('dispatchWhatsAppWorkflow', () => {
  it('non-owner never dispatches', async () => {
    mockState.triggerNodes = [{ id: 'n1', workflowId: 'wf1', config: { keyword: 'news' } }];
    mockState.workflowsQueue = [[{ id: 'wf1', name: 'News Digest' }]];

    const res = await dispatchWhatsAppWorkflow(NON_OWNER, 'news bitcoin');
    expect(res).toEqual({ dispatched: false });
    expect(mockEngineExecute).not.toHaveBeenCalled();
  });

  it('dispatches the matching workflow with the stripped message as input', async () => {
    mockState.triggerNodes = [{ id: 'n1', workflowId: 'wf1', config: { keyword: 'news' } }];
    // findMatching exists-check + dispatchRun load.
    mockState.workflowsQueue = [
      [{ id: 'wf1', name: 'News Digest' }],
      [{ id: 'wf1', name: 'News Digest' }],
    ];

    const res = await dispatchWhatsAppWorkflow(OWNER, 'news bitcoin');
    expect(res).toEqual({ dispatched: true, workflowName: 'News Digest' });

    expect(mockEngineExecute).toHaveBeenCalledTimes(1);
    const initialInput = mockEngineExecute.mock.calls[0][2];
    expect(initialInput).toEqual({
      message: 'bitcoin',
      rawMessage: 'news bitcoin',
      from: OWNER,
      matchedKeyword: 'news',
    });
  });

  it('falls through (dispatched:false) when no workflow matches', async () => {
    mockState.triggerNodes = [{ id: 'n1', workflowId: 'wf1', config: { keyword: 'news' } }];
    const res = await dispatchWhatsAppWorkflow(OWNER, 'what is the weather');
    expect(res).toEqual({ dispatched: false });
    expect(mockEngineExecute).not.toHaveBeenCalled();
  });

  it('empty text never dispatches', async () => {
    const res = await dispatchWhatsAppWorkflow(OWNER, '   ');
    expect(res).toEqual({ dispatched: false });
    expect(mockEngineExecute).not.toHaveBeenCalled();
  });

  it('dispatches only the FIRST when multiple workflows match, and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockState.triggerNodes = [
      { id: 'n1', workflowId: 'wf1', config: { keyword: 'news' } },
      { id: 'n2', workflowId: 'wf2', config: { keyword: 'news' } },
    ];
    // findMatching exists-check for both, then dispatchRun load for the chosen (first).
    mockState.workflowsQueue = [
      [{ id: 'wf1', name: 'First News' }],
      [{ id: 'wf2', name: 'Second News' }],
      [{ id: 'wf1', name: 'First News' }],
    ];

    const res = await dispatchWhatsAppWorkflow(OWNER, 'news bitcoin');
    expect(res).toEqual({ dispatched: true, workflowName: 'First News' });
    expect(mockEngineExecute).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('matched'));
    warnSpy.mockRestore();
  });
});
