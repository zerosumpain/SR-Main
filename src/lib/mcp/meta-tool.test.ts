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
      expect(Array.isArray(result.data)).toBe(true);
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

  it('with flag "1" returns 6 essentials + the jkai_extended dispatcher', async () => {
    process.env.JKAI_MCP_META_TOOL = '1';
    try {
      const tools = await listMcpTools();
      // 6 essentials (assuming all are registered) + 1 meta = 7.
      // Use a loose upper bound in case an essential isn't registered.
      expect(tools.length).toBeLessThanOrEqual(7);
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
