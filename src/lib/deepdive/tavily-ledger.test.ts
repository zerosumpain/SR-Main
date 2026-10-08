import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The ledger writes through Drizzle; what these tests are about is the row it
// builds and the client recording every attempt, so the database is a stub.
const inserted: Record<string, unknown>[] = [];
const insert = vi.fn(() => ({
  values: (row: Record<string, unknown>) => {
    inserted.push(row);
    return Promise.resolve();
  },
}));
const update = vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) }));
vi.mock('$lib/db', () => ({ db: { insert, update } }));
vi.mock('$lib/llm/keys', () => ({ getTavilyKey: () => 'tvly-test-key-123' }));

const { tavilyCallRow, TAVILY_ACTION } = await import('./tavily-ledger');
const { search, extract } = await import('./tavily');
const { runWithResearchMeter } = await import('$lib/context/research-meter');
const { executionContext } = await import('$lib/context/execution');
const { withActivity } = await import('$lib/context/activity');

const NO_AMBIENT = {
  researchSessionId: null,
  workflowId: null,
  runId: null,
  nodeId: null,
  activity: null,
  conversationId: null,
  jobId: null,
};

const base = {
  kind: 'search' as const,
  purpose: 'research.phase1',
  depth: 'basic' as const,
  query: 'uk school funding 2026',
  credits: 1,
  ok: true,
  durationMs: 812.4,
  attempt: 1,
};

describe('the ledger row', () => {
  it('is a tavily_call, never an llm_call, and keeps credits out of cost_usd', () => {
    const row = tavilyCallRow(base, NO_AMBIENT);
    expect(row.actionType).toBe(TAVILY_ACTION);
    expect(row.actionType).not.toBe('llm_call');
    expect(row).not.toHaveProperty('costUsd');
    expect(row.provider).toBe('tavily');
    expect(row.toolName).toBe('search');
    expect(row.input).toMatchObject({ app: 'main', purpose: 'research.phase1', credits: 1, query: base.query });
    expect(row.durationMs).toBe(812);
  });

  it('counts a failed request at zero credits and keeps its error', () => {
    const row = tavilyCallRow({ ...base, ok: false, httpStatus: 432, error: 'plan limit' }, NO_AMBIENT);
    expect(row.status).toBe('failed');
    expect(row.input.credits).toBe(0);
    expect(row.input.httpStatus).toBe(432);
    expect(row.error).toBe('plan limit');
  });

  it('never stores a Tavily key, in the query or the error', () => {
    const row = tavilyCallRow(
      { ...base, query: 'why tvly-abcDEF123 leaked', ok: false, error: 'bad key tvly-abcDEF123' },
      NO_AMBIENT,
    );
    expect(JSON.stringify(row)).not.toContain('tvly-abcDEF123');
  });

  it('keeps the first ten URLs of an extract and the full count', () => {
    const urls = Array.from({ length: 14 }, (_, i) => `https://example.com/${i}`);
    const row = tavilyCallRow({ ...base, kind: 'extract', query: undefined, urls, credits: 3 }, NO_AMBIENT);
    expect(row.input.urlCount).toBe(14);
    expect(row.input.urls).toHaveLength(10);
    expect(row.input).not.toHaveProperty('query');
  });

  it('joins on the research run first, then the workflow run, then the chat job', () => {
    const all = { ...NO_AMBIENT, researchSessionId: 'rs', runId: 'run', jobId: 'job', workflowId: 'wf' };
    expect(tavilyCallRow(base, all).sessionId).toBe('rs');
    expect(tavilyCallRow(base, { ...all, researchSessionId: null }).sessionId).toBe('run');
    expect(tavilyCallRow(base, { ...NO_AMBIENT, jobId: 'job' }).sessionId).toBe('job');
    expect(tavilyCallRow(base, NO_AMBIENT).sessionId).toBeNull();
  });
});

describe('the Tavily client records every request', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    inserted.length = 0;
    vi.useFakeTimers({ toFake: ['setTimeout'] });
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('writes a search with its query, options, credits and the research run it served', async () => {
    globalThis.fetch = vi.fn(async () => ok({ results: [{ title: 'a', url: 'u', content: 'c', score: 1 }] }));
    await runWithResearchMeter('sess-9', () =>
      search('heat pumps', { purpose: 'research.phase1', maxResults: 10, searchDepth: 'advanced', topic: 'news' }),
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ actionType: 'tavily_call', status: 'completed', sessionId: 'sess-9' });
    expect(inserted[0].input).toMatchObject({
      purpose: 'research.phase1',
      query: 'heat pumps',
      depth: 'advanced',
      credits: 2,
      resultCount: 1,
      researchSessionId: 'sess-9',
      options: { maxResults: 10, topic: 'news' },
    });
  });

  it('writes the workflow node and the LLM workload a call ran under', async () => {
    globalThis.fetch = vi.fn(async () => ok({ results: [] }));
    await executionContext.run({ workflowId: 'wf-1', runId: 'run-1', nodeId: 'n-1', llmCalls: [] }, () =>
      withActivity('daily-briefing', () => search('q', { purpose: 'workflow.tavily-search' })),
    );
    expect(inserted[0].input).toMatchObject({ workflowId: 'wf-1', runId: 'run-1', nodeId: 'n-1', activity: 'daily-briefing' });
    expect(inserted[0].sessionId).toBe('run-1');
  });

  it('writes both attempts when the first is refused and the retry succeeds', async () => {
    let n = 0;
    globalThis.fetch = vi.fn(async () => (++n === 1 ? new Response('busy', { status: 429 }) : ok({ results: [] })));
    const pending = search('retry me', { purpose: 'research.phase3' });
    await vi.runAllTimersAsync();
    await pending;
    expect(inserted.map((r) => [r.status, (r.input as any).attempt, (r.input as any).credits])).toEqual([
      ['failed', 1, 0],
      ['completed', 2, 1],
    ]);
    expect((inserted[0].input as any).httpStatus).toBe(429);
  });

  it('writes a network failure and still throws it', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const pending = search('down', { purpose: 'tool.tavily_search' }).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await pending).toBeInstanceOf(TypeError);
    expect(inserted).toHaveLength(2);
    expect(inserted.every((r) => r.status === 'failed' && r.error === 'fetch failed')).toBe(true);
  });

  it('writes an extract with its URLs and per-batch credits', async () => {
    globalThis.fetch = vi.fn(async () => ok({ results: [{ url: 'x', raw_content: 'y' }], failed_results: [] }));
    const urls = Array.from({ length: 6 }, (_, i) => `https://example.org/${i}`);
    await extract(urls, { purpose: 'research.keep-in-drive' });
    expect(inserted[0]).toMatchObject({ toolName: 'extract', status: 'completed' });
    expect(inserted[0].input).toMatchObject({ purpose: 'research.keep-in-drive', urlCount: 6, credits: 2 });
  });
});
