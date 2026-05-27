// jkai_extended — single dispatcher tool that collapses ~128 extended tools
// behind list / schema / invoke operations. Surfaced in `tools/list` only
// when JKAI_MCP_META_TOOL=1 (see ./essentials.ts). The underlying registry
// is unchanged — tools/call by name still works for the extended set, so
// any tool the LLM discovers via jkai_extended.list can be either invoked
// through `jkai_extended` (operation:"invoke") or called directly by name.
//
// Why a meta-tool: with 130+ tools the MCP manifest pushes ~28k tokens into
// every Hermes prompt before the user message is even seen. Phase 3 of the
// prefill-reduction plan (docs/plans/2026-05-27-jkai-prefill-reduction.md).

import { executeTool, getTools } from '$lib/workflows/site-tools/registry';
import type { ToolExecContext } from '$lib/workflows/site-tools/registry-internal';
import { ESSENTIAL_TOOL_NAMES } from './essentials';
import type { McpTool } from './server';

export type MetaOperation = 'list' | 'schema' | 'invoke';

export interface MetaToolInput {
  operation: MetaOperation;
  query?: string;
  name?: string;
  args?: Record<string, unknown>;
}

interface ExtendedToolListEntry {
  name: string;
  description: string;
}

interface ExtendedToolSchemaEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface MetaErrorResult {
  error: string;
}

/**
 * The MCP-shaped tool definition for jkai_extended. Same shape as anything
 * returned by listMcpTools() — { name, description, inputSchema } — so it
 * slots into the tools/list array without a special case downstream.
 *
 * Note: this is NOT registered into the site-tools registry (it'd show up
 * inside its own list operation, which would be confusing). It's injected
 * directly at the tools/list layer in $lib/mcp/server.ts when the flag is
 * on, and dispatched here when tools/call lands on `jkai_extended`.
 */
export const JKAI_EXTENDED_TOOL: McpTool = {
  name: 'jkai_extended',
  description:
    "Discover and invoke jkai's extended tool catalogue (~128 tools across " +
    'blog, health, workflow, gmail, research, scraper, files, build, ' +
    'schedule, home-assistant, render, document, image, audio, system ' +
    'domains). Use this when you need a capability beyond the essential ' +
    'tools you can see directly. Workflow: operation="list" to discover ' +
    '(optionally with a substring "query" filter), operation="schema" with ' +
    '"name" to fetch the exact argument schema, then operation="invoke" ' +
    'with "name" and "args" to run it.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['list', 'schema', 'invoke'],
        description:
          '"list" returns matching tool names + descriptions; ' +
          '"schema" returns the full input JSON Schema for one named tool; ' +
          '"invoke" executes a named tool with the provided args.',
      },
      query: {
        type: 'string',
        description:
          'For operation="list" only. Optional case-insensitive substring filter on tool name or description.',
      },
      name: {
        type: 'string',
        description:
          'For operation="schema" and operation="invoke". The exact tool name (e.g. "gmail_search", "blog_create_post").',
      },
      args: {
        type: 'object',
        description:
          'For operation="invoke" only. The tool\'s argument object — must match the inputSchema returned by operation="schema".',
        additionalProperties: true,
      },
    },
    required: ['operation'],
  },
};

function getExtendedTools(): ReturnType<typeof getTools> {
  const all = getTools();
  return all.filter((t) => !ESSENTIAL_TOOL_NAMES.has(t.name)) as typeof all;
}

/**
 * Dispatch a jkai_extended call. Returns plain JS values (arrays, objects);
 * the jsonrpc layer wraps the result in MCP content envelopes.
 *
 * Errors from invalid input (unknown tool, missing required fields) are
 * returned as `{ error }` objects rather than thrown, so the LLM gets a
 * structured response it can self-correct from rather than a tool-execution
 * failure that gets summarised away.
 */
export async function dispatchMetaTool(
  input: MetaToolInput | Record<string, unknown> | null | undefined,
  ctx?: ToolExecContext,
): Promise<
  | ExtendedToolListEntry[]
  | ExtendedToolSchemaEntry
  | { success: boolean; data?: unknown; error?: string }
  | MetaErrorResult
> {
  const operation = (input as MetaToolInput | undefined)?.operation;
  const query = (input as MetaToolInput | undefined)?.query;
  const name = (input as MetaToolInput | undefined)?.name;
  const args = (input as MetaToolInput | undefined)?.args;

  if (!operation) {
    return { error: 'jkai_extended: "operation" is required (one of: list, schema, invoke)' };
  }

  const extended = getExtendedTools();

  if (operation === 'list') {
    const filtered = query
      ? extended.filter((t) => {
          const q = query.toLowerCase();
          return (
            t.name.toLowerCase().includes(q) ||
            (t.description ?? '').toLowerCase().includes(q)
          );
        })
      : extended;
    return filtered.map((t) => ({
      name: t.name,
      description: t.description ?? '',
    }));
  }

  if (operation === 'schema') {
    if (!name) return { error: 'jkai_extended: operation="schema" requires "name"' };
    const tool = extended.find((t) => t.name === name);
    if (!tool) return { error: `jkai_extended: unknown tool "${name}" (not in extended catalogue)` };
    return {
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.parameters as unknown as Record<string, unknown>) ?? {
        type: 'object',
        properties: {},
      },
    };
  }

  if (operation === 'invoke') {
    if (!name) return { error: 'jkai_extended: operation="invoke" requires "name"' };
    const tool = extended.find((t) => t.name === name);
    if (!tool) return { error: `jkai_extended: unknown tool "${name}" (not in extended catalogue)` };
    // Reuse the registry's executeTool so we get the same handler error
    // envelope as a direct tools/call. ctx is forwarded so progress emits
    // and conversationId-aware tools (e.g. workflow_build_from_spec) work
    // identically through the dispatcher and through the direct path.
    return await executeTool(name, args ?? {}, ctx);
  }

  return { error: `jkai_extended: unknown operation "${String(operation)}" (expected: list, schema, invoke)` };
}
