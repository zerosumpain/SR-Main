// src/lib/workflows/site-tools/tools/node-call.ts
//
// Run a workflow node's executor directly, without a canvas around it.
//
// Why this exists: roughly fifty capabilities in this repo are implemented once,
// as workflow nodes, and were reachable only by building a graph. When chat was
// asked for Apple Calendar actions the CalDAV client, the credential
// decryption and the event serialisation already existed and had worked for
// months — but the only route to them was a full change-request build against
// the repo. That build spent 2M tokens and 52 minutes and shipped nothing.
//
// The interesting consumer is not chat directly, it is the custom-tool
// sandbox. `platform.call` reaches every registered tool, so an authored tool
// can now do
//
//   const cal = await platform.call('node_call', { type: 'apple-calendar', config: {...} });
//
// and be promoted into a permanent tool the same minute — no branch, no PR, no
// deploy. That is the fast lane the calendar request needed and could not find.
//
// READ-ONLY, DELIBERATELY. Every entry below is a node that fetches and returns;
// nothing here sends, publishes, writes or spends. Two reasons. The obvious one
// is that `platform.call` is reachable from LLM-authored handler code, and an
// ungated write path into fifty integrations from generated JavaScript is not a
// trade worth making. The less obvious one is that a generic runner cannot
// write a decent confirmation prompt: "run node `whatsapp` with config {...}?"
// tells the owner far less than "Send WhatsApp message to X?". Writes keep
// their purpose-built, individually-gated tools, where the prompt can say what
// is about to happen. See `apple_calendar_create` for the shape.
//
// FAILS CLOSED. A type absent from ALLOWED is refused, so a node added
// tomorrow is not exposed by having been written. That direction is not
// theoretical: `definitionsForBuild` granted every tool when its toolset list
// matched nothing, and stayed harmless right up until a UI could produce an
// empty list (PR #203).

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';
import { standaloneContext } from '$lib/workflows/standalone-context';

interface StandaloneNode {
  /** Why it is safe to run this one outside a graph, in one line. */
  why: string;
  /**
   * Optional config check. Nodes that branch on an `operation` need one, since
   * the type alone does not say whether this call reads or writes.
   * Return an error string to refuse, or null to allow.
   */
  guard?: (config: Record<string, unknown>) => string | null;
}

/**
 * The fast lane's whole surface. Adding a capability to chat is a line here
 * plus nothing else — which is the point of the file.
 */
export const ALLOWED: Record<string, StandaloneNode> = {
  'apple-calendar': {
    why: 'Reads iCloud calendars and events over CalDAV.',
    // The same executor creates, updates and deletes events. Only the read is
    // on the fast lane; `apple_calendar_create` owns the write and is
    // confirmation-gated.
    guard: (config) =>
      config.operation === 'list'
        ? null
        : `node_call runs apple-calendar in read-only mode: operation must be "list", not "${String(config.operation ?? 'unset')}". Use apple_calendar_create to add an event — it asks before writing.`,
  },
  'weather-brief': { why: 'Fetches a forecast.' },
  'location-context': { why: 'Reads recent location history.' },
  strava: { why: 'Reads activities.' },
  whoop: { why: 'Reads recovery and sleep data.' },
  'tavily-search': { why: 'Web search.' },
  'research-search': { why: 'Runs a research query.' },
  'health-query': { why: 'Reads stored health metrics.' },
  'site-mapper': { why: 'Crawls and returns a site structure.' },
  'file-search': { why: 'Semantic search over the /drive file store.' },
  'gmail-search': { why: 'Searches mail; returns matches only.' },
  'gmail-fetch': { why: 'Reads messages and threads.' },
};

/** Names an allowed type, for error messages and the tool description. */
function allowedList(): string {
  return Object.keys(ALLOWED).sort().join(', ');
}

export async function handleNodeCall(args: Record<string, unknown>): Promise<ToolResult> {
  const type = typeof args.type === 'string' ? args.type.trim() : '';
  if (!type) {
    return { success: false, error: `\`type\` is required. Runnable node types: ${allowedList()}.` };
  }

  const entry = ALLOWED[type];
  if (!entry) {
    // Distinguish "no such node" from "that node exists but is not on the fast
    // lane" — they need different next steps from the caller.
    const { registry } = await import('$lib/workflows');
    const exists = Boolean(registry.getDefinition(type));
    return {
      success: false,
      error: exists
        ? `Node type "${type}" exists but is not runnable outside a workflow. node_call is read-only; if this node writes, publishes or sends, use its own tool, or build a workflow. Runnable types: ${allowedList()}.`
        : `No node type "${type}". Runnable types: ${allowedList()}. Call workflow_list_node_types to see everything the canvas offers.`,
    };
  }

  const config = (args.config as Record<string, unknown>) ?? {};
  if (typeof config !== 'object' || Array.isArray(config)) {
    return { success: false, error: '`config` must be an object.' };
  }

  const refusal = entry.guard?.(config);
  if (refusal) return { success: false, error: refusal };

  const { registry } = await import('$lib/workflows');
  const executor = registry.getExecutor(type);
  if (!executor) {
    return { success: false, error: `Node type "${type}" is allowed but has no registered executor.` };
  }

  const context = standaloneContext({ nodeId: `node_call:${type}` });
  try {
    const result = await executor.execute((args.input as Record<string, unknown>) ?? {}, config, context);
    return {
      success: true,
      data: {
        output: result.output,
        rowCount: result.rowCount,
        // Executors that report progress do it through `emit`; surfacing the
        // buffer means a caller is not left guessing what a slow node was doing.
        events: context.events.length ? context.events : undefined,
      },
    };
  } catch (err) {
    // A node's own error message is the useful one — it names the missing
    // credential, the unknown calendar, the expired token. Pass it through
    // rather than replacing it with a generic failure.
    return {
      success: false,
      error: err instanceof Error ? `${type}: ${err.message}` : `${type}: ${String(err)}`,
    };
  }
}

register({
  name: 'node_call',
  description:
    'Run one workflow node directly, without building a workflow — the way to reach a capability that exists only as a canvas node. ' +
    `Runnable types: ${allowedList()}. ` +
    'Call `workflow_describe_node` first to get the exact config schema for the type you want; pass that as `config`. ' +
    'READ-ONLY: these nodes fetch and return. Anything that sends, publishes or writes has its own tool, which asks before acting. ' +
    'Useful inside an authored tool too: `platform.call("node_call", { type, config })` lets a custom tool reuse the site’s integrations instead of re-implementing credentials.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: `Node type to run. One of: ${allowedList()}.`,
      },
      config: {
        type: 'object',
        description:
          'The node’s configuration, matching its configSchema — get it from workflow_describe_node. Credentials are referenced by id and resolved server-side; never put a secret here.',
      },
      input: {
        type: 'object',
        description: 'Optional input payload, as an upstream node would supply. Defaults to {}.',
      },
    },
    required: ['type', 'config'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: handleNodeCall,
});
