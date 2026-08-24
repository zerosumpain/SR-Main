import { describe, it, expect } from 'vitest';
import '$lib/workflows/site-tools/registry';
import { tools } from '$lib/workflows/site-tools/registry-internal';
import { getToolsetDefinitions } from '$lib/workflows/site-tools/registry';

const byName = (n: string) => tools.find((t) => t.name === n);
const run = async (n: string, args: Record<string, unknown> = {}) =>
  (await byName(n)!.handler(args)) as { success: boolean; data?: never; error?: string };

describe('discovery toolset', () => {
  it('registers all four verbs', () => {
    for (const n of ['skills_list', 'skill_view', 'tool_search', 'tool_describe']) {
      expect(byName(n), `${n} not registered`).toBeDefined();
      expect(byName(n)!.toolset).toBe('discovery');
    }
  });

  it('is reachable without activating a toolset first', () => {
    // Tools for FINDING tools are useless if you must know to activate them.
    expect(getToolsetDefinitions('discovery').length).toBe(4);
  });

  it('skills_list returns the library, and filters when asked', async () => {
    const all = await run('skills_list');
    expect(all.success).toBe(true);
    expect((all.data as never as { count: number }).count).toBeGreaterThan(100);

    const filtered = await run('skills_list', { query: 'canvas workflow', limit: 5 });
    const d = filtered.data as never as { count: number; skills: Array<{ id: string }> };
    expect(d.count).toBeLessThanOrEqual(5);
    expect(d.skills.length).toBeGreaterThan(0);
  });

  it('skill_view returns real content for a known skill', async () => {
    const list = (await run('skills_list')).data as never as { skills: Array<{ id: string }> };
    const r = await run('skill_view', { name: list.skills[0].id });
    expect(r.success).toBe(true);
    expect((r.data as never as { content: string }).content.length).toBeGreaterThan(50);
  });

  it('skill_view fails helpfully on an unknown name', async () => {
    const r = await run('skill_view', { name: 'no-such-skill-xyz' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no skill|skills_list/);
  });

  it('skill_view refuses a reference outside the skill', async () => {
    const list = (await run('skills_list')).data as never as { skills: Array<{ id: string }> };
    const r = await run('skill_view', { name: list.skills[0].id, reference: '../../secrets' });
    expect(r.success).toBe(false);
  });

  it('tool_search finds a tool by a word in its description, not just its name', async () => {
    const r = await run('tool_search', { query: 'calendar' });
    expect(r.success).toBe(true);
    const d = r.data as never as { count: number; searched: number };
    expect(d.searched).toBeGreaterThan(50);
    expect(d.count).toBeGreaterThan(0);
  });

  it('tool_search searches across ALL toolsets, not only active ones', async () => {
    const r = await run('tool_search', { query: 'blog post', limit: 50 });
    const d = r.data as never as { tools: Array<{ toolset: string }> };
    // The point is reach: it must surface tools from toolsets that were never
    // activated. (Discovery tools may legitimately match too — `skills_list`
    // names "blog" in its own description — so assert on what else is there.)
    const others = d.tools.map((t) => t.toolset).filter((t) => t !== 'discovery');
    expect(others.length).toBeGreaterThan(0);
  });

  it('tool_search requires a real query', async () => {
    expect((await run('tool_search', { query: ' ' })).success).toBe(false);
  });

  it('tool_describe returns the exact parameter schema', async () => {
    const target = tools.find((t) => t.name !== 'tool_describe' && t.parameters)!;
    const r = await run('tool_describe', { name: target.name });
    expect(r.success).toBe(true);
    expect((r.data as never as { parameters: unknown }).parameters).toEqual(target.parameters);
  });

  it('tool_describe suggests near matches for a typo', async () => {
    const r = await run('tool_describe', { name: 'tool_desc' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Closest|tool_search/);
  });
});
