import type { McpTool } from './server';

/**
 * The `jkai_extended` tool definition, on its own.
 *
 * It is a plain object — a name, a description and an input schema — and the
 * chat endpoint imports it for the schema alone. It used to live in
 * `meta-tool.ts`, which also implements the operations behind it and therefore
 * reads the tool catalogue; so importing this const dragged `load-registry` and,
 * through it, all 175 tool modules onto chat's runtime graph.
 *
 * Same shape as the fix in SR-Main #868, where fourteen lines of SELECT sitting
 * in `orchestrator/index.ts` cost 449 files until they moved to a leaf. A
 * definition that describes a capability does not need the code that performs
 * it, and putting them in one file makes every reader of the first pay for the
 * second.
 *
 * `meta-tool.ts` re-exports it, so nothing that already imported it there had to
 * change.
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
