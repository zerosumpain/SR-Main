// src/lib/workflows/site-tools/tools/ephemeral-tools.ts
// Meta-tools that let the LLM author one-shot tools and, later, promote
// them into the persistent customTools registry.

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';
import { db } from '$lib/db';
import { orchestratorChats, customTools } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { buildHandler } from '../custom-tool-loader';

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

// -------- promote_ephemeral_tool --------

type EphemeralSidecar = {
  handlerCode: string;
  parameters: JSONSchema;
  proposedName?: string;
  proposedDescription?: string;
};

type StoredToolStep = {
  id?: string;
  tool: string;
  args?: Record<string, unknown>;
  result?: { data?: Record<string, unknown> };
  ephemeral?: EphemeralSidecar;
};

register({
  name: 'promote_ephemeral_tool',
  description:
    'Persist a previously-run ephemeral tool into the reusable custom tools registry. Use only after an ephemeral tool has run successfully in this conversation.',
  toolset: 'visualise',
  category: 'Visualise',
  parameters: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'orchestrator_chats.id of the assistant message where the ephemeral ran.' },
      toolCallId: { type: 'string', description: 'The step id (or tool name if id absent) within that message\'s toolSteps.' },
      name: { type: 'string', description: 'Override name. Defaults to sidecar.proposedName.' },
      description: { type: 'string', description: 'Override description. Defaults to sidecar.proposedDescription.' },
      toolset: { type: 'string', description: 'Optional toolset. Defaults to "visualise".' },
    },
    required: ['messageId', 'toolCallId'],
  },
  handler: async (args): Promise<ToolResult> => {
    const messageId = args.messageId as string;
    const toolCallId = args.toolCallId as string;
    const nameOverride = args.name as string | undefined;
    const descOverride = args.description as string | undefined;
    const toolsetName = (args.toolset as string | undefined) ?? 'visualise';

    if (!messageId) return { success: false, error: 'messageId is required' };
    if (!toolCallId) return { success: false, error: 'toolCallId is required' };

    const rows = await db
      .select()
      .from(orchestratorChats)
      .where(eq(orchestratorChats.id, messageId))
      .limit(1);
    const msg = rows[0];
    if (!msg) return { success: false, error: `message ${messageId} not found` };

    const meta = (msg.metadata as { toolSteps?: StoredToolStep[] } | null) ?? {};
    const steps = meta.toolSteps ?? [];
    const step = steps.find((s) => s.id === toolCallId) ?? steps.find((s) => s.tool === toolCallId);
    if (!step) return { success: false, error: `tool step ${toolCallId} not found on message ${messageId}` };
    const sidecar = step.ephemeral;
    if (!sidecar) {
      return { success: false, error: `tool step ${toolCallId} has no ephemeral sidecar — not an ephemeral run` };
    }

    const finalName = nameOverride ?? sidecar.proposedName;
    const finalDesc = descOverride ?? sidecar.proposedDescription;
    if (!finalName) return { success: false, error: 'no name available (no override, no sidecar.proposedName)' };
    if (!finalDesc) return { success: false, error: 'no description available (no override, no sidecar.proposedDescription)' };

    // Name collision check
    const existing = await db
      .select()
      .from(customTools)
      .where(eq(customTools.name, finalName))
      .limit(1);
    if (existing.length > 0) {
      return {
        success: false,
        error: `a custom tool named "${finalName}" already exists — pass a different \`name\` override`,
      };
    }

    await db.insert(customTools).values({
      name: finalName,
      description: finalDesc,
      toolset: toolsetName,
      parameters: sidecar.parameters,
      handlerCode: sidecar.handlerCode,
      enabled: true,
    });

    // Register live so the LLM can use it immediately without a process restart
    register({
      name: finalName,
      description: finalDesc,
      toolset: toolsetName,
      category: 'Custom Tool',
      parameters: sidecar.parameters,
      handler: buildHandler(finalName, sidecar.handlerCode),
    });

    return {
      success: true,
      data: { name: finalName, description: finalDesc, toolset: toolsetName },
    };
  },
});
