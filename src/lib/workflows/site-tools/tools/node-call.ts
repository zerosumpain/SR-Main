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

import { registerWorkflowTool } from '../workflow-service';

/**
 * The types SR-Workflows' node_call accepts (its ALLOWED map, which also holds
 * each type's read-only guard). Only the names are needed here, for the
 * description the model reads; the guards run where the node runs.
 */
const ALLOWED_TYPES = ['apple-calendar', 'location-context', 'tavily-search', 'weather-brief', 'whoop'];

function allowedList(): string {
  return ALLOWED_TYPES.join(', ');
}

// Runs in SR-Workflows, which owns the node executors; this registration only
// describes the tool to Main's catalogue (MCP and chat both read it).
registerWorkflowTool({
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
});
