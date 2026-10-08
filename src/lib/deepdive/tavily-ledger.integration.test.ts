/**
 * The Tavily ledger against the disposable integration database: a request
 * made through the real client lands in `agent_actions` and comes back out of
 * the /admin/ops/tavily queries. Tavily itself is stubbed — no credit is spent.
 * Rows are identified by purpose prefix and removed after every case; this
 * file must only be run in the hermetic integration lane.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { executionContext } from '$lib/context/execution';
import { search, extract } from './tavily';
import { getTavilyAudit } from '$lib/server/tavily-audit';

vi.mock('$lib/llm/keys', () => ({ getTavilyKey: () => 'tvly-itest' }));

const PREFIX = 'itest.tavily-ledger.';
const realFetch = globalThis.fetch;

async function cleanup(): Promise<void> {
  await db.execute(sql`delete from agent_actions where action_type = 'tavily_call' and input ->> 'purpose' like ${`${PREFIX}%`}`);
}

/** The write is fire-and-forget, so wait for it rather than racing it. */
async function rowsFor(purpose: string, expected: number) {
  for (let i = 0; i < 50; i++) {
    const res = await db.execute(sql`select * from agent_actions where action_type = 'tavily_call' and input ->> 'purpose' = ${purpose}`);
    if (res.rows.length >= expected) return res.rows as Record<string, any>[];
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`ledger rows for ${purpose} never arrived`);
}

beforeEach(cleanup);
afterEach(async () => {
  globalThis.fetch = realFetch;
  await cleanup();
});

describe.skipIf(!process.env.DATABASE_URL)('Tavily ledger', () => {
  it('records a workflow search and an extract, and the audit groups them', async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/extract')
        ? new Response(JSON.stringify({ results: [{ url: 'u', raw_content: 'text' }], failed_results: [] }))
        : new Response(JSON.stringify({ results: [{ title: 't', url: 'u', content: 'c', score: 1 }] })),
    ) as typeof fetch;

    const searchPurpose = `${PREFIX}search`;
    const extractPurpose = `${PREFIX}extract`;
    await executionContext.run({ workflowId: 'itest-wf', runId: 'itest-run', nodeId: 'n1', llmCalls: [] }, () =>
      search('itest query', { purpose: searchPurpose, searchDepth: 'advanced' }),
    );
    await extract(['https://example.com/a', 'https://example.com/b'], { purpose: extractPurpose });

    const [s] = await rowsFor(searchPurpose, 1);
    expect(s.tool_name).toBe('search');
    expect(s.session_id).toBe('itest-run');
    expect(s.cost_usd).toBeNull();
    expect(s.input).toMatchObject({ app: 'main', query: 'itest query', credits: 2, workflowId: 'itest-wf' });
    await rowsFor(extractPurpose, 1);

    const audit = await getTavilyAudit(1);
    const byPurpose = new Map(audit.byPurpose.map((p) => [p.purpose, p]));
    expect(byPurpose.get(searchPurpose)).toMatchObject({ calls: 1, credits: 2, searches: 1 });
    expect(byPurpose.get(extractPurpose)).toMatchObject({ calls: 1, credits: 1, extracts: 1 });
    expect(audit.byTrigger.some((t) => t.kind === 'workflow' && t.id === 'itest-wf')).toBe(true);

    const filtered = await getTavilyAudit(1, searchPurpose);
    expect(filtered.recent.every((r) => r.purpose === searchPurpose)).toBe(true);
    expect(filtered.recent[0]).toMatchObject({ query: 'itest query', credits: 2, ok: true, trigger: { kind: 'workflow' } });
  });

  it('records a refused request at zero credits without touching the LLM cost readers', async () => {
    globalThis.fetch = vi.fn(async () => new Response('quota', { status: 432 })) as typeof fetch;
    const purpose = `${PREFIX}refused`;
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const pending = search('refused', { purpose }).catch((e) => e);
      await vi.runAllTimersAsync();
      expect(await pending).toBeInstanceOf(Error);
    } finally {
      vi.useRealTimers();
    }
    const rows = await rowsFor(purpose, 2);
    expect(rows.map((r) => [r.status, r.input.credits, r.input.httpStatus])).toEqual([
      ['failed', 0, 432],
      ['failed', 0, 432],
    ]);
    const llm = await db.execute(sql`select count(*)::int as n from agent_actions where action_type = 'llm_call' and input ->> 'purpose' = ${purpose}`);
    expect(llm.rows[0].n).toBe(0);
  });
});
