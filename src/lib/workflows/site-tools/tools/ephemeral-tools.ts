// src/lib/workflows/site-tools/tools/ephemeral-tools.ts
// Meta-tools that let the LLM author one-shot tools and, later, promote
// them into the persistent customTools registry.

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';

type JSONSchema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };

type PlatformCall = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
type Handler = (
  args: Record<string, unknown>,
  fetch: typeof globalThis.fetch,
  platform: { call: PlatformCall },
) => Promise<ToolResult>;

const MAX_EPHEMERAL_DEPTH = 5;
let currentDepth = 0;

function compileHandler(code: string): Handler {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return new AsyncFunction('args', 'fetch', 'platform', code) as Handler;
}

async function buildEphemeralPlatform(callerName: string): Promise<{ call: PlatformCall }> {
  return {
    async call(name, args) {
      if (currentDepth >= MAX_EPHEMERAL_DEPTH) {
        return {
          success: false,
          error: `ephemeral platform.call depth limit (${MAX_EPHEMERAL_DEPTH}) exceeded while calling "${name}" from "${callerName}".`,
        };
      }
      const { executeTool } = await import('../registry');
      currentDepth++;
      try {
        return await executeTool(name, args);
      } finally {
        currentDepth--;
      }
    },
  };
}

// -------- author_ephemeral_tool --------

register({
  name: 'author_ephemeral_tool',
  description:
    'Author and run a one-shot tool for this turn only. Use when no existing tool fits and the task needs data fetching / transformation before rendering. Handler receives (args, fetch, platform) where platform.call invokes any registered tool (e.g. render_chart). Return an ArtifactToolData envelope `{ artifact, summary }` for multimedia responses.',
  toolset: 'visualise',
  category: 'Visualise',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Proposed tool name, snake_case. Only persisted if promoted.' },
      description: { type: 'string', description: 'What the tool does (visible to future tool selection if promoted).' },
      parameters: {
        type: 'object',
        description: 'JSON Schema describing the tool\'s parameters.',
      },
      handlerCode: {
        type: 'string',
        description: 'Async JS body. Has access to args, fetch, platform. Return { success, data?, error? }.',
      },
      callArgs: {
        type: 'object',
        description: 'Arguments to pass to the handler for this invocation.',
      },
    },
    required: ['name', 'description', 'parameters', 'handlerCode', 'callArgs'],
  },
  handler: async (args): Promise<ToolResult> => {
    const name = args.name as string;
    const description = args.description as string;
    const parameters = args.parameters as JSONSchema;
    const handlerCode = args.handlerCode as string;
    const callArgs = (args.callArgs as Record<string, unknown>) ?? {};

    if (!name || typeof name !== 'string') return { success: false, error: 'name is required' };
    if (!handlerCode || typeof handlerCode !== 'string') {
      return { success: false, error: 'handlerCode is required' };
    }

    let compiled: Handler;
    try {
      compiled = compileHandler(handlerCode);
    } catch (err) {
      return { success: false, error: `handlerCode syntax error: ${err instanceof Error ? err.message : String(err)}` };
    }

    const platform = await buildEphemeralPlatform(name);

    let result: ToolResult;
    try {
      result = await compiled(callArgs, globalThis.fetch, platform);
    } catch (err) {
      return { success: false, error: `ephemeral handler threw: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (!result || typeof result !== 'object' || typeof result.success !== 'boolean') {
      return { success: false, error: 'ephemeral handler must return { success, data?, error? }' };
    }

    if (!result.success) return result;

    // Attach the ephemeral sidecar to data so the chat persistence layer
    // can extract it and store it on the message row for later promotion.
    const existingData = (result.data as Record<string, unknown> | undefined) ?? {};
    const enrichedData = {
      ...existingData,
      __ephemeral__: {
        handlerCode,
        parameters,
        proposedName: name,
        proposedDescription: description,
      },
    };
    return { success: true, data: enrichedData };
  },
});
