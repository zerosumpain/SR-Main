// jkai_extended — single dispatcher tool that collapses ~128 extended tools
// behind list / schema / invoke operations. Surfaced in `tools/list` only
// when JKAI_MCP_META_TOOL=1 (see ./essentials.ts). The underlying registry
// is unchanged — tools/call by name still works for the extended set, so
// any tool the LLM discovers via jkai_extended.list can be either invoked
// through `jkai_extended` (operation:"invoke") or called directly by name.
//
// Why a meta-tool: with 130+ tools the MCP manifest pushes ~28k tokens into
// every agent prompt before the user message is even seen. Phase 3 of the
// prefill-reduction plan (docs/plans/2026-05-27-jkai-prefill-reduction.md).

import { executeTool, getTools } from '$lib/workflows/site-tools/registry';
import type { ToolExecContext } from '$lib/workflows/site-tools/registry-internal';
import { isEssentialUnderPolicy } from './essentials';
import { describeWithPolicy, getActivePolicy, type ToolPolicyVersion } from '$lib/toolpolicy/policy';
import type { McpTool } from './server';

export type MetaOperation = 'list' | 'schema' | 'invoke';

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
  /**
   * The tool's required argument names, omitted when it has none.
   *
   * The cheapest thing a `schema` round trip bought was usually this — over
   * ten measured conversations, 18 of 68 discovery calls were schema fetches,
   * most for tools with four arguments or fewer.
   *
   * Measured cost: 104 of 145 tools carry one, +2,824 bytes over the WHOLE
   * catalogue (+12.9% compact, +6.5% full). That is the worst case — an
   * unfiltered survey — and a `query` narrows it to tens of bytes, which is
   * how the model actually calls this. Against it: one fewer request, response
   * and assistant turn per tool first reached for.
   *
   * Names only, deliberately: types and optional arguments are what `schema`
   * is still for, and inlining them would rebuild the manifest this dispatcher
   * exists to avoid.
   */
  required?: string[];
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
    // The domain list is the model's cheapest map of what jkai can reach, and
    // for a long time it named `gmail` but neither `calendar` nor `payments`.
    // That is not cosmetic: on 2026-08-15 two calendar questions routed to
    // Google before Apple Calendar, and on 2026-08-16 a PayPal question spent
    // fourteen Gmail searches while `api_integration_call` sat one call away.
    // A domain that is absent here is a domain the model does not know it has.
    'blog, health, calendar, workflow, gmail, payments and API integrations, ' +
    'research, scraper, files and drive, datastore, the intel knowledge graph, ' +
    'build, schedule, monitors, agents, decks, home-assistant, render, ' +
    'document, image, audio, system domains). Use this when you need a ' +
    'capability beyond the essential tools you can see directly. Workflow: ' +
    'operation="list" to discover (optionally with a "query" — plain words ' +
    'work, e.g. "add a tool" or "read my calendar"; results are ranked by how ' +
    'well they match — or compact=true for a cheap name+truncated-description ' +
    'catalogue survey). Every list entry carries its REQUIRED argument names, ' +
    'so for a tool with few arguments you can go straight from "list" to ' +
    '"invoke" — operation="schema" is only worth a round trip when you need ' +
    'the full types or the optional arguments. Use operation="schema" with ' +
    '"name" (or "names" to batch several schemas in one call) for that, then ' +
    'operation="invoke" with "name" and "args" to run it.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['list', 'schema', 'invoke'],
        description:
          '"list" returns matching tool names + descriptions; ' +
          '"schema" returns the full input JSON Schema for one or more named tools; ' +
          '"invoke" executes a named tool with the provided args.',
      },
      query: {
        type: 'string',
        description:
          'For operation="list" only. Words describing the capability you want — a phrase is fine ("add a tool", "fix a broken tool", "read the calendar"). Matches on tool name and description and returns the best matches first. Combine with compact=true for a lean filtered survey.',
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
          'For operation="list" only. When true, returns a leaner entry per tool — {name, description, required} with the description truncated to ~120 chars and no destructive flag — so a full-catalogue survey costs far fewer tokens. The required argument names are kept even here, because they are what lets you skip the schema call.',
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

/** Words too common in tool prose to narrow anything. */
const STOPWORDS = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'and', 'or', 'in', 'on', 'my', 'me', 'new', 'use']);

/**
 * Rank the catalogue against a query.
 *
 * This was a single `includes(query)` over name and description, which is a
 * fine answer to "calendar" and a useless one to anything a person would
 * actually type. Measured against production on 2026-08-11:
 *
 *   "calendar"        → 2 hits
 *   "create tool"     → 0
 *   "add a tool"      → 0
 *   "new capability"  → 0
 *
 * Three words, nothing. A model looking for a way to add a capability found
 * nothing and fell back to what it already knew, which is a large part of why
 * a tool request became a 50-minute repo build. The exact-phrase match is kept
 * as the top rank — it is the best signal when it fires — and everything below
 * it is ordinary word overlap, so a multi-word query degrades to "the tools
 * mentioning the most of these words" instead of to silence.
 */
export function searchTools<T extends { name: string; description?: string }>(
  tools: readonly T[],
  query: string,
): T[] {
  const q = query.toLowerCase().trim();
  if (!q) return [...tools];
  const words = q.split(/[^a-z0-9_]+/).filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const scored = tools
    .map((t) => {
      const name = t.name.toLowerCase();
      const desc = (t.description ?? '').toLowerCase();
      const haystack = `${name} ${desc}`;
      let score = 0;
      // Whole query as a phrase — the old behaviour, now the strongest signal.
      if (name.includes(q)) score += 100;
      else if (desc.includes(q)) score += 50;
      // Then per-word overlap, weighted towards the name.
      for (const w of words) {
        if (name.includes(w)) score += 10;
        else if (haystack.includes(w)) score += 3;
      }
      return { t, score };
    })
    .filter((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));
  return scored.map((s) => s.t);
}

/**
 * The `required` names off a tool's JSON Schema, or nothing.
 *
 * Returns a spreadable object rather than an array so an empty list is simply
 * absent from the entry — `required: []` reads as "this tool takes no
 * arguments", which is a different and often wrong claim.
 */
export function withRequired(parameters: unknown): { required?: string[] } {
  const raw = (parameters as { required?: unknown } | null)?.required;
  if (!Array.isArray(raw)) return {};
  const names = raw.filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
  return names.length ? { required: names } : {};
}

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
    const filtered = query ? searchTools(extended, query) : extended;
    if (compact) {
      // `required` rides even the compact survey. It is the one field that can
      // replace a whole round trip, and a handful of argument names is cheaper
      // than the description already being returned beside it.
      return filtered.map((t) => ({
        name: t.name,
        description: truncateDescription(describeWithPolicy(policy, t.name, t.description ?? '')),
        ...withRequired(t.parameters),
      }));
    }
    return filtered.map((t) => ({
      name: t.name,
      description: describeWithPolicy(policy, t.name, t.description ?? ''),
      ...withRequired(t.parameters),
      ...(t.destructive ? { destructive: true } : {}),
    }));
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

  return { error: `jkai_extended: unknown operation "${String(operation)}" (expected: list, schema, invoke)` };
}
