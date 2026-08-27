// Exposes the full site-tools registry over MCP. See
// jsonrpc.ts for the JSON-RPC dispatcher and auth model.
// Toolset-level filtering is handled by the client's skills, not here.
//
// Exception: when JKAI_MCP_META_TOOL=1, tools/list collapses to the 6
// essential tools (see ./essentials.ts) plus the `jkai_extended` meta-tool
// (see ./meta-tool.ts) which exposes the rest via list/schema/invoke. The
// tools/call dispatch path is unaffected — extended tools remain callable
// by name. This is a prompt-token optimisation, not an access-control gate.
//
// Descriptions and visibility are then passed through the tool-call policy
// overlay ($lib/toolpolicy/policy.ts) — the self-improvement engine's
// non-destructive lever for reducing how many calls a question takes. The
// overlay can only rewrite description text and promote a tool into the
// visible set; names, schemas and handlers come from the registry alone, so a
// bad overlay degrades hints and never breaks a call.

import {
  getTools,
} from '$lib/workflows/site-tools/registry';
import type { ToolDefinition } from '$lib/workflows/site-tools/registry-internal';
import { isEssentialUnderPolicy, isMetaToolEnabled } from './essentials';
import { JKAI_EXTENDED_TOOL } from './meta-tool';
import {
  describeWithPolicy,
  getActivePolicy,
  renderGlobalGuidance,
  type ToolPolicyVersion,
} from '$lib/toolpolicy/policy';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * MCP standard tool annotations. `destructiveHint` mirrors the site-tool's
   * `destructive` flag so the calling agent can require user confirmation
   * before invoking it — the live-path equivalent of the in-repo
   * confirmation gate (which only covers the legacy general-chat engine).
   */
  annotations?: { destructiveHint?: boolean };
}

export interface McpCallResult {
  content: Array<{ type: 'text'; text: string }>;
}

function toolToMcp(def: ToolDefinition, policy: ToolPolicyVersion): McpTool {
  return {
    name: def.name,
    description: describeWithPolicy(policy, def.name, def.description ?? ''),
    inputSchema: (def.parameters as unknown as Record<string, unknown>) ?? {
      type: 'object',
      properties: {},
    },
    ...(def.destructive ? { annotations: { destructiveHint: true } } : {}),
  };
}

/**
 * Today's date, in London.
 *
 * An agent's system prompt often carries no date at all, and most jkai tools want an
 * absolute ISO instant, so "3 days ago" or "tomorrow" cost a `current_date`
 * round trip before anything else could run — four of them across the ten
 * conversations this came out of.
 *
 * **This must never be attached to a tool DESCRIPTION.** It was, briefly, and
 * that was wrong: a client discovers tools once on connect and re-discovers only
 * on a `notifications/tools/list_changed` notification, which this server does
 * not send. So a date in the manifest is frozen at connect time and goes stale
 * for as long as the gateway stays up — and a confidently-stated wrong date is
 * strictly worse than no date, because the model has no reason to doubt it.
 * It rides `jkai_extended` RESULTS instead, which are built per call and can
 * never be stale.
 *
 * **Date only, never a clock**, for the same reason it is worth stating at all:
 * results are not cached, but keeping the two surfaces identical means nobody
 * later moves a timestamp into the cached one.
 */
export function todayLine(now: Date = new Date()): string {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long' }).format(now);
  return `${weekday} ${date} (Europe/London)`;
}

export async function listMcpTools(): Promise<McpTool[]> {
  const tools = getTools();
  const policy = await getActivePolicy();
  if (isMetaToolEnabled()) {
    const essentials = tools
      .filter((t) => isEssentialUnderPolicy(t.name, policy))
      .map((t) => toolToMcp(t, policy));
    // Cross-cutting call-efficiency rules ride on the meta-tool description:
    // it is the one definition every turn sees regardless of which tools the
    // model ends up reaching for. Anything that CHANGES over time must not —
    // see `todayLine`, which is why the date lives on results instead.
    const guidance = renderGlobalGuidance(policy);
    const meta = guidance
      ? { ...JKAI_EXTENDED_TOOL, description: JKAI_EXTENDED_TOOL.description + guidance }
      : JKAI_EXTENDED_TOOL;
    return [...essentials, meta];
  }
  return tools.map((t) => toolToMcp(t, policy));
}

/**
 * Accept either `workflow_id` (plan-spec name) or `workflowId` (actual tool
 * schema name). The MCP server uses it for scope binding only; arguments pass
 * through to the handler untouched.
 */
export function resolveWorkflowId(args: Record<string, unknown>): string {
  return String(args.workflow_id ?? args.workflowId ?? '');
}
