import { describe, it, expect, beforeAll } from 'vitest';
import { JKAI_EXTENDED_TOOL, dispatchMetaTool } from './meta-tool';
import { ESSENTIAL_TOOL_NAMES } from './essentials';
import { listMcpTools } from './server';
import type { ToolExecContext } from '$lib/workflows/site-tools/registry-internal';

// Tests need the registry populated. Importing registry.ts pulls in the
// side-effect tool registrations.
beforeAll(async () => {
  await import('$lib/workflows/site-tools/registry');
});

const fakeCtx: ToolExecContext = { emit: () => {} };

describe('jkai_extended meta-tool', () => {
  describe('tool definition', () => {
    it('declares the expected name and operation enum', () => {
      expect(JKAI_EXTENDED_TOOL.name).toBe('jkai_extended');
      const schema = JKAI_EXTENDED_TOOL.inputSchema as {
        properties: { operation: { enum: string[] } };
        required: string[];
      };
      expect(schema.properties.operation.enum).toEqual(['list', 'schema', 'invoke']);
      expect(schema.required).toContain('operation');
    });
  });

  describe('operation="list" (compact)', () => {
    it('with compact:true returns lean {name, truncated description} entries and no destructive field', async () => {
      const result = await dispatchMetaTool({ operation: 'list', compact: true }, fakeCtx);
      expect(Array.isArray(result)).toBe(true);
      const list = result as unknown as Array<Record<string, unknown>>;
      expect(list.length).toBeGreaterThan(50);
      for (const entry of list) {
        expect(typeof entry.name).toBe('string');
        expect(typeof entry.description).toBe('string');
        expect('destructive' in entry).toBe(false);
        expect((entry.description as string).length).toBeLessThanOrEqual(120);
      }
    });

    it('with compact:true truncates long descriptions with an ellipsis', async () => {
      const full = (await dispatchMetaTool({ operation: 'list' }, fakeCtx)) as Array<{
        name: string;
        description: string;
      }>;
      const longOne = full.find((t) => (t.description ?? '').length > 120);
      const compact = (await dispatchMetaTool(
        { operation: 'list', compact: true },
        fakeCtx,
      )) as Array<{ name: string; description: string }>;
      const compactOne = compact.find((t) => t.name === longOne?.name);
      if (longOne) {
        expect(compactOne).toBeTruthy();
        expect(compactOne!.description.length).toBeLessThan(full.find((t) => t.name === longOne.name)!.description.length);
        expect(compactOne!.description).toMatch(/…$/);
      }
    });

    it('compact combines with a query filter', async () => {
      const result = await dispatchMetaTool(
        { operation: 'list', query: 'gmail', compact: true },
        fakeCtx,
      );
      const list = result as unknown as Array<Record<string, unknown>>;
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((t) => 'destructive' in t === false)).toBe(true);
    });
  });

  describe('operation="list"', () => {
    it('returns the extended catalogue and excludes essentials', async () => {
      const result = await dispatchMetaTool({ operation: 'list' }, fakeCtx);
      expect(Array.isArray(result)).toBe(true);
      const list = result as Array<{ name: string; description: string }>;
      expect(list.length).toBeGreaterThan(50);
      const names = list.map((t) => t.name);
      for (const essential of ESSENTIAL_TOOL_NAMES) {
        expect(names).not.toContain(essential);
      }
    });

    it('filters by substring query against name or description (case-insensitive)', async () => {
      const result = await dispatchMetaTool(
        { operation: 'list', query: 'GMAIL' },
        fakeCtx,
      );
      const list = result as Array<{ name: string; description: string }>;
      expect(list.length).toBeGreaterThan(0);
      expect(
        list.every(
          (t) =>
            t.name.toLowerCase().includes('gmail') ||
            (t.description ?? '').toLowerCase().includes('gmail'),
        ),
      ).toBe(true);
    });

    it('returns empty array for non-matching query rather than throwing', async () => {
      const result = await dispatchMetaTool(
        { operation: 'list', query: 'xxxx_no_such_tool_xxxx' },
        fakeCtx,
      );
      expect(result).toEqual([]);
    });
  });

  describe('operation="schema"', () => {
    it('returns name + description + inputSchema for a known extended tool', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'schema', name: 'gmail_search' },
        fakeCtx,
      )) as { name: string; description: string; inputSchema: Record<string, unknown> };
      expect(result.name).toBe('gmail_search');
      expect(result.description).toBeTruthy();
      expect(result.inputSchema).toBeDefined();
      expect((result.inputSchema as { type?: string }).type).toBe('object');
    });

    it('returns an error object for an essential tool (essentials are not in the extended catalogue)', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'schema', name: 'save_memory' },
        fakeCtx,
      )) as { error?: string };
      expect(result.error).toMatch(/unknown tool/i);
    });

    it('returns an error object for an unknown tool name', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'schema', name: 'does_not_exist_anywhere' },
        fakeCtx,
      )) as { error?: string };
      expect(result.error).toMatch(/unknown tool/i);
    });

    it('requires "name"', async () => {
      const result = (await dispatchMetaTool({ operation: 'schema' }, fakeCtx)) as {
        error?: string;
      };
      expect(result.error).toMatch(/requires "name"/);
    });
  });

  describe('operation="schema" (batch via names)', () => {
    it('returns an array of schema entries, one per requested tool', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'schema', names: ['gmail_search', 'blog_list'] },
        fakeCtx,
      )) as unknown as Array<{ name: string; inputSchema: Record<string, unknown> }>;
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
      const names = result.map((e) => e.name);
      expect(names).toEqual(expect.arrayContaining(['gmail_search', 'blog_list']));
      for (const entry of result) {
        expect(entry.inputSchema).toBeDefined();
        expect((entry.inputSchema as { type?: string }).type).toBe('object');
      }
    });

    it('returns a single-object error when names contains an unknown tool and reports it', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'schema', names: ['gmail_search', 'does_not_exist_anywhere'] },
        fakeCtx,
      )) as { error?: string };
      expect(Array.isArray(result)).toBe(false);
      expect(result.error).toMatch(/unknown tool/i);
      expect(result.error).toMatch(/does_not_exist_anywhere/);
    });

    it('lists multiple unknown names in the error', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'schema', names: ['nope_one', 'nope_two'] },
        fakeCtx,
      )) as { error?: string };
      expect(result.error).toMatch(/nope_one/);
      expect(result.error).toMatch(/nope_two/);
    });

    it('dedupes repeated names in a batch', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'schema', names: ['gmail_search', 'gmail_search'] },
        fakeCtx,
      )) as Array<{ name: string }>;
      expect(result).toHaveLength(1);
    });

    it('single-`name` still returns a single object, not an array (no regression)', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'schema', name: 'blog_list' },
        fakeCtx,
      )) as { name: string; inputSchema: Record<string, unknown> };
      expect(Array.isArray(result)).toBe(false);
      expect(result.name).toBe('blog_list');
      expect(result.inputSchema).toBeDefined();
    });
  });

  describe('operation="invoke"', () => {
    it('returns an error object for an unknown tool (no throw)', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'invoke', name: 'does_not_exist_anywhere', args: {} },
        fakeCtx,
      )) as { error?: string };
      expect(result.error).toMatch(/unknown tool/i);
    });

    it('requires "name"', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'invoke', args: {} },
        fakeCtx,
      )) as { error?: string };
      expect(result.error).toMatch(/requires "name"/);
    });

    it('dispatches a real extended tool via the registry (workflow_list_node_types is side-effect-free)', async () => {
      const result = (await dispatchMetaTool(
        {
          operation: 'invoke',
          name: 'workflow_list_node_types',
          args: { workflow_id: 'wf_meta_test' },
        },
        fakeCtx,
      )) as { success: boolean; data?: unknown };
      expect(result.success).toBe(true);
      expect(Array.isArray((result.data as { types: unknown[] }).types)).toBe(true);
    });

    it('refuses to invoke an essential tool (essentials are not in the extended catalogue)', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'invoke', name: 'save_memory', args: { fact: 'x' } },
        fakeCtx,
      )) as { error?: string };
      expect(result.error).toMatch(/unknown tool/i);
    });
  });

  describe('input validation', () => {
    it('returns an error when operation is missing', async () => {
      const result = (await dispatchMetaTool({} as never, fakeCtx)) as { error?: string };
      expect(result.error).toMatch(/operation.*required/i);
    });

    it('returns an error for unknown operation', async () => {
      const result = (await dispatchMetaTool(
        { operation: 'destroy' as never },
        fakeCtx,
      )) as { error?: string };
      expect(result.error).toMatch(/unknown operation/i);
    });

    it('tolerates null/undefined input', async () => {
      const r1 = (await dispatchMetaTool(null, fakeCtx)) as { error?: string };
      const r2 = (await dispatchMetaTool(undefined, fakeCtx)) as { error?: string };
      expect(r1.error).toBeDefined();
      expect(r2.error).toBeDefined();
    });
  });
});

describe('listMcpTools() env-flag behaviour', () => {
  const originalFlag = process.env.JKAI_MCP_META_TOOL;

  it('with flag OFF returns the full registry (default behaviour, no regression)', async () => {
    delete process.env.JKAI_MCP_META_TOOL;
    const tools = await listMcpTools();
    expect(tools.length).toBeGreaterThan(50);
    expect(tools.find((t) => t.name === 'jkai_extended')).toBeUndefined();
    expect(tools.find((t) => t.name === 'blog_list')).toBeTruthy();
  });

  it('with flag "1" returns the essentials + the jkai_extended dispatcher', async () => {
    process.env.JKAI_MCP_META_TOOL = '1';
    try {
      const tools = await listMcpTools();
      // Manifest stays tiny under the meta-tool: at most the registered essentials
      // + the jkai_extended dispatcher. Bound tracks ESSENTIAL_TOOL_NAMES so adding
      // an essential doesn't silently balloon the MCP prefill without updating this.
      expect(tools.length).toBeLessThanOrEqual(ESSENTIAL_TOOL_NAMES.size + 1);
      expect(tools.length).toBeGreaterThan(1);
      expect(tools.find((t) => t.name === 'jkai_extended')).toBeTruthy();
      expect(tools.find((t) => t.name === 'save_memory')).toBeTruthy();
      expect(tools.find((t) => t.name === 'whatsapp_send')).toBeTruthy();
      // Extended tools should be hidden.
      expect(tools.find((t) => t.name === 'blog_list')).toBeUndefined();
      expect(tools.find((t) => t.name === 'gmail_search')).toBeUndefined();
    } finally {
      if (originalFlag === undefined) {
        delete process.env.JKAI_MCP_META_TOOL;
      } else {
        process.env.JKAI_MCP_META_TOOL = originalFlag;
      }
    }
  });
});
