import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { emptyPolicy, invalidateToolPolicyCache } from '$lib/toolpolicy/policy';

// The end-to-end contract 2.1 rests on: a promoted tool must become directly
// visible AND leave the extended catalogue. `isPromoted` was already unit
// tested; that a promotion actually MOVES a tool between the two surfaces was
// not, and it is the only reason promoting is worth manifest tokens at all.
const promoted = ['ha_query_state', 'gmail_search'];
vi.mock('$lib/toolpolicy/policy', async (orig) => {
  const actual = await orig<typeof import('$lib/toolpolicy/policy')>();
  return {
    ...actual,
    getActivePolicy: vi.fn(async () => ({ ...actual.emptyPolicy(), promoteToEssential: promoted })),
  };
});

import { listMcpTools } from './server';
import { dispatchMetaTool } from './meta-tool';

beforeAll(async () => { await import('$lib/workflows/site-tools/registry'); });
afterEach(() => invalidateToolPolicyCache());

describe('promoting a tool moves it between the two surfaces', () => {
  const flag = process.env.JKAI_MCP_META_TOOL;
  afterEach(() => { if (flag === undefined) delete process.env.JKAI_MCP_META_TOOL; else process.env.JKAI_MCP_META_TOOL = flag; });

  it('surfaces it directly in tools/list', async () => {
    process.env.JKAI_MCP_META_TOOL = '1';
    const names = (await listMcpTools()).map((t) => t.name);
    for (const p of promoted) expect(names, p).toContain(p);
    expect(names).toContain('jkai_extended');
    // A tool that is neither essential nor promoted must stay hidden, or
    // promotion is measuring nothing.
    expect(names).not.toContain('blog_list');
  });

  it('removes it from the extended catalogue, so it cannot be reached two ways', async () => {
    const list = (await dispatchMetaTool({ operation: 'list' }, { emit: () => {} } as never)) as unknown as Array<{ name: string }>;
    const names = list.map((e) => e.name);
    for (const p of promoted) expect(names, p).not.toContain(p);
    expect(names).toContain('blog_list');
  });

  it('emptyPolicy promotes nothing, so the base case is unchanged', () => {
    expect(emptyPolicy().promoteToEssential).toEqual([]);
  });
});
