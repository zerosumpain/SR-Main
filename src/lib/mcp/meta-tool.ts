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
import { isEssentialUnderPolicy } from './essentials';
import { describeWithPolicy, getActivePolicy, type ToolPolicyVersion } from '$lib/toolpolicy/policy';
import type { McpTool } from './server';

export type MetaOperation = 'list' | 'schema' | 'invoke' | 'names';

export interface MetaToolInput {
  operation: MetaOperation;
  query?: string;
  name?: string;
  /** Batch schema fetch: array of tool names to describe in one call. */
  names?: string[];
  /** Compact list flag: return {name, truncated description} only. */
  compact?: boolean;
  args?: Record<string, unknown>;
}

interface ExtendedToolListEntry {
  name: string;
  description: string;
  /** True when the tool has a side effect that should be confirmed first. */
  destructive?: boolean;
}

interface ExtendedToolSchemaEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** True when the tool has a side effect that should be confirmed first. */
  destructive?: boolean;
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
    '(optionally with a substring "query" filter, or compact=true for a cheap ' +
    'name+truncated-description catalogue survey), operation="schema" with ' +
    '"name" (or "names" to batch several schemas in one call) to fetch the ' +
    'exact argument schema, then operation="invoke" with "name" and ' +
    '"args" to run it.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['list', 'schema', 'invoke', 'names'],
        description:
          '"list" returns matching tool names + descriptions; ' +
          '"schema" returns the full input JSON Schema for one or more named tools; ' +
          '"invoke" executes a named tool with the provided args; ' +
          '"names" returns only tool names (cheapest, no descriptions).',
      },
      query: {
        type: 'string',
        description:
          'For operation="list" only. Optional case-insensitive substring filter on tool name or description. Combine with compact=true for a lean filtered survey.',
      },
      name: {
        type: 'string',
        description:
          'For operation="schema" and operation="invoke". The exact tool name (e.g. "gmail_search", "blog_create_post"). For "schema" you may pass either this single name or `names` to batch several in one call; either is sufficient.',
      },
      names: {
        type: 'array',
        items: { type: 'string' },
        description:
          'For operation="schema" only. Batch fetch: an array of tool names to describe in ONE call, e.g. ["gmail_search", "blog_list"]. Returns an array of schema entries (one per tool). Prefer this over many single-`name` calls to save round-trips. Any unknown name produces an error object listing them.',
      },
      compact: {
        type: 'boolean',
        description:
          'For operation="list" only. When true, returns a leaner entry per tool — just {name, description} with the description truncated to ~120 chars and no destructive flag — so a full-catalogue survey costs far fewer tokens.',
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

const MAX_COMPACT_DESC = 120;

function truncateDescription(desc: string): string {
  return desc.length > MAX_COMPACT_DESC
    ? `${desc.slice(0, MAX_COMPACT_DESC - 1).trimEnd()}…`
    : desc;
}

function getExtendedTools(policy: ToolPolicyVersion): ReturnType<typeof getTools> {
  const all = getTools();
  // A tool promoted into the visible set must leave the extended catalogue, or
  // the model sees it twice and can reach it by two different call shapes.
  return all.filter((t) => !isEssentialUnderPolicy(t.name, policy)) as typeof all;
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
  const names = (input as MetaToolInput | undefined)?.names;
  const compact = (input as MetaToolInput | undefined)?.compact;
  const args = (input as MetaToolInput | undefined)?.args;

  if (!operation) {
    return { error: 'jkai_extended: "operation" is required (one of: list, schema, invoke)' };
  }

  // Descriptions here go through the same policy overlay as tools/list, so a
  // published call-efficiency hint reaches the model whether it discovers the
  // tool directly or through this dispatcher.
  const policy = await getActivePolicy();
  const extended = getExtendedTools(policy);

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
    if (compact) {
      return filtered.map((t) => ({
        name: t.name,
        description: truncateDescription(describeWithPolicy(policy, t.name, t.description ?? '')),
      }));
    }
    return filtered.map((t) => ({
      name: t.name,
      description: describeWithPolicy(policy, t.name, t.description ?? ''),
      ...(t.destructive ? { destructive: true } : {}),
    }));
  }

  // names: cheapest possible survey — just tool names, no descriptions, no filtering.
  // Use when all you need to check is "does a tool for X exist" without paying for
  // 128 descriptions you won't read.
  if (operation === 'names') {
    return extended.map((t) => t.name);
  }

  if (operation === 'schema') {
    const hasNames = Array.isArray(names) && names.length > 0;
    const requested = hasNames
      ? [
          ...new Set(
            names
              .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
              .map((n) => n.trim()),
          ),
        ]
      : typeof name === 'string' && name.trim().length > 0
        ? [name.trim()]
        : [];

    if (requested.length === 0) {
      return { error: 'jkai_extended: operation="schema" requires "name" or "names"' };
    }

    const schemas: ExtendedToolSchemaEntry[] = [];
    const unknown: string[] = [];
    for (const n of requested) {
      const tool = extended.find((t) => t.name === n);
      if (!tool) {
        unknown.push(n);
        continue;
      }
      schemas.push({
        name: tool.name,
        description: describeWithPolicy(policy, tool.name, tool.description ?? ''),
        inputSchema: (tool.parameters as unknown as Record<string, unknown>) ?? {
          type: 'object',
          properties: {},
        },
        ...(tool.destructive ? { destructive: true } : {}),
      });
    }

    if (unknown.length > 0) {
      return {
        error: `jkai_extended: unknown tool(s): ${unknown.join(', ')} (not in extended catalogue)`,
      };
    }

    // Single-`name` call keeps the original shape: one schema object, not an array.
    if (!hasNames) return schemas[0];
    return schemas;
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

  return { error: `jkai_extended: unknown operation "${String(operation)}" (expected: list, names, schema, invoke)` };
}
