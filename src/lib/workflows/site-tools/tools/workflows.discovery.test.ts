import { describe, it, expect, vi } from 'vitest';
import { executeTool } from '../registry';
import '$lib/workflows';

/**
 * Fake db rows used by workflow_list tests. select() is projection-aware: when
 * the handler passes a column projection (compact mode) it returns only the
 * compact fields; when it passes none (verbose mode) it returns the full rows.
 * This proves the projection is a real code path, not cosmetic.
 */
vi.mock('$lib/db', () => {
  const fullRows = [
    {
      id: 'wf-1',
      name: 'Daily Digest',
      description: 'Summarise the day\'s activity',
      trigger: { type: 'cron', cron: '0 9 * * *' },
      notifications: { email: 'me@example.com' },
      createdAt: '2026-08-01T09:00:00.000Z',
      updatedAt: '2026-08-05T09:00:00.000Z',
    },
    {
      id: 'wf-2',
      name: 'Deploy',
      description: null,
      trigger: { type: 'manual' },
      notifications: null,
      createdAt: '2026-08-02T09:00:00.000Z',
      updatedAt: '2026-08-06T09:00:00.000Z',
    },
  ];
  const COMPACT = ['id', 'name', 'description', 'trigger', 'updatedAt'];
  const compactRows = fullRows.map((r) => Object.fromEntries(COMPACT.map((k) => [k, (r as any)[k]])));
  const makeQueryBuilder = (projected: unknown) => {
    const q: any = {
      from: () => q,
      orderBy: () => q,
      where: () => q,
      limit: () => (projected ? compactRows : fullRows),
    };
    return q;
  };
  return { db: { select: vi.fn((proj: unknown) => makeQueryBuilder(proj)) } };
});

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

/**
 * `workflow_amend` validates every op against the live registry BEFORE it opens
 * a transaction, so a typo costs one message naming the op rather than a
 * rollback and a round-trip. None of these reach the database.
 */
describe('workflow_amend pre-flight validation', () => {
  async function amend(args: Record<string, unknown>) {
    return (await executeTool('workflow_amend', args)) as { success: boolean; error?: string };
  }

  it('rejects an empty op list', async () => {
    const r = await amend({ workflowId: 'w1', ops: [] });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/at least one op/i);
  });

  it('fails the whole amend on an op kind it does not implement, instead of dropping it', async () => {
    // The silent partial failure this tool exists to prevent. An op nobody
    // implemented matched no case in the executor: no write, no error, and the
    // result still said the amend succeeded. `set_schedule` is the realistic
    // guess — it was in an earlier draft of this tool's op list.
    const r = await amend({
      workflowId: 'w1',
      ops: [
        { op: 'set_schedule', cron: '0 9 * * *' },
        { op: 'add_node', type: 'delay', label: 'Wait' },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('op 1 (set_schedule)');
    expect(r.error).toMatch(/unrecognised op/i);
    // Says what IS allowed, so the retry is informed rather than another guess.
    expect(r.error).toContain('insert_between');
  });

  it('rejects an op with no `op` key at all', async () => {
    const r = await amend({ workflowId: 'w1', ops: [{ nodeId: 'n1', label: 'Renamed' }] });
    expect(r.success).toBe(false);
    expect(r.error).toContain('no "op" key');
  });

  it('names the offending op when a node type does not exist', async () => {
    const r = await amend({
      workflowId: 'w1',
      ops: [
        { op: 'add_edge', sourceNodeId: 'a', targetNodeId: 'b' },
        { op: 'add_node', type: 'delayy', label: 'Wait' },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('op 2 (add_node)');
    expect(r.error).toContain('Unknown node type "delayy"');
  });

  it('validates the config of a spliced node too', async () => {
    const r = await amend({
      workflowId: 'w1',
      ops: [
        {
          op: 'insert_between',
          sourceNodeId: 'a',
          targetNodeId: 'b',
          type: 'delay',
          label: 'Wait',
          config: { notARealKey: 1 },
        },
      ],
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('op 1 (insert_between)');
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

/**
 * workflow_list token bloat — issue #126.
 *
 * The bare `db.select().from(workflows)` dumped every column of up to 50 rows
 * (~12k tokens). Default is now the compact projection; verbose:true opts back
 * into the full rows.
 */
describe('workflow_list compact vs verbose', () => {
  it('returns compact rows by default (no heavy columns)', async () => {
    const r = (await executeTool('workflow_list', {})) as { success: boolean; data: unknown[] };
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);
    const first = r.data[0] as Record<string, unknown>;
    // Identifying fields present.
    expect(first.id).toBe('wf-1');
    expect(first.name).toBe('Daily Digest');
    expect(first.description).toBeDefined();
    expect(first.trigger).toEqual({ type: 'cron', cron: '0 9 * * *' });
    expect(first.updatedAt).toBeDefined();
    // Heavy columns dropped from the compact projection.
    expect('notifications' in first).toBe(false);
    expect('createdAt' in first).toBe(false);
  });

  it('returns full rows when verbose:true', async () => {
    const r = (await executeTool('workflow_list', { verbose: true })) as {
      success: boolean;
      data: Array<Record<string, unknown>>;
    };
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);
    const first = r.data[0];
    expect(first.id).toBe('wf-1');
    expect(first.notifications).toEqual({ email: 'me@example.com' });
    expect(first.createdAt).toBeDefined();
    expect(first.updatedAt).toBeDefined();
  });
});
