import { describe, it, expect } from 'vitest';
import { executeTool } from '../registry';
import '$lib/workflows';

/**
 * Node discovery ergonomics.
 *
 * `workflow_list_node_types` used to take no arguments at all: every call dumped
 * the whole catalogue at ~5,120 tokens. Production shows the model paying that
 * roughly once per build and then guessing the rest of the config shapes, which
 * is how "Unknown config key" reached the verifier 13 times in one session.
 */

type ListData = {
  matched: number;
  total: number;
  note?: string;
  types: Array<{ type: string; label: string; category: string; description: string }>;
};

async function list(args: Record<string, unknown> = {}) {
  const r = (await executeTool('workflow_list_node_types', args)) as {
    success: boolean;
    data: ListData;
  };
  expect(r.success).toBe(true);
  return r.data;
}

describe('workflow_list_node_types filtering', () => {
  it('returns the whole catalogue when unfiltered', async () => {
    const data = await list();
    expect(data.types.length).toBe(data.total);
    expect(data.total).toBeGreaterThan(50);
    expect(data.note).toBeUndefined();
  });

  it('narrows hard on a specific query — the whole point of the change', async () => {
    const all = await list();
    const data = await list({ query: 'whatsapp' });
    expect(data.matched).toBeGreaterThan(0);
    expect(data.matched).toBeLessThan(all.total / 2);
    expect(data.types.some((t) => t.type.includes('whatsapp'))).toBe(true);
    expect(data.note).toMatch(/Filtered to/);
  });

  it('ORs space-separated words so one call covers a family', async () => {
    const single = await list({ query: 'whatsapp' });
    const multi = await list({ query: 'whatsapp email' });
    expect(multi.matched).toBeGreaterThan(single.matched);
  });

  it('falls back to the full catalogue when nothing matches, and says so', async () => {
    // Silence here would read as "that capability does not exist" and send the
    // model off to jkai-node-builder to build a node that already exists.
    const data = await list({ query: 'zzzznotarealnodetype' });
    expect(data.matched).toBe(0);
    expect(data.types.length).toBeGreaterThan(50);
    expect(data.note).toMatch(/do not conclude the capability is missing/i);
  });

  it('filters by category', async () => {
    const data = await list({ category: 'control' });
    expect(data.matched).toBeGreaterThan(0);
    expect(data.types.every((t) => t.category === 'control')).toBe(true);
  });
});

describe('workflow_describe_node batching', () => {
  it('describes several types in one call', async () => {
    const r = (await executeTool('workflow_describe_node', {
      types: ['llm-call', 'conditional', 'merge'],
    })) as { success: boolean; data: { nodes: Array<{ type: string }> } };
    expect(r.success).toBe(true);
    expect(r.data.nodes.map((n) => n.type).sort()).toEqual(['conditional', 'llm-call', 'merge']);
  });

  it('still accepts a single `type` and keeps the old flat shape', async () => {
    const r = (await executeTool('workflow_describe_node', { type: 'llm-call' })) as {
      success: boolean;
      data: { type: string; configSchema: unknown; nodes: unknown[] };
    };
    expect(r.success).toBe(true);
    expect(r.data.type).toBe('llm-call');
    expect(r.data.configSchema).toBeDefined();
    expect(r.data.nodes).toHaveLength(1);
  });

  it('returns the known types alongside the unknown ones', async () => {
    // A partial miss must not cost the model the whole batch.
    const r = (await executeTool('workflow_describe_node', {
      types: ['llm-call', 'not-a-real-node'],
    })) as { success: boolean; data: { nodes: Array<{ type: string }>; unknown: string[] } };
    expect(r.success).toBe(true);
    expect(r.data.nodes).toHaveLength(1);
    expect(r.data.unknown).toEqual(['not-a-real-node']);
  });

  it('fails when every requested type is unknown', async () => {
    const r = (await executeTool('workflow_describe_node', { types: ['nope', 'also-nope'] })) as {
      success: boolean;
      error: string;
    };
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown node type/);
  });

  it('fails when nothing is passed', async () => {
    const r = (await executeTool('workflow_describe_node', {})) as { success: boolean; error: string };
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Pass `types`/);
  });
});
