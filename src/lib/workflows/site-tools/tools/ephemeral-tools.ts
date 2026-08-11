// src/lib/workflows/site-tools/tools/ephemeral-tools.ts
// Meta-tools that let the LLM author one-shot tools and, later, promote
// them into the persistent customTools registry.

import { register } from '../registry-internal';
import type { ToolResult } from '../registry-internal';
import { db } from '$lib/db';
import { orchestratorChats, customTools } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { buildHandler } from '../custom-tool-loader';
import { refuseDestructiveCall } from '../platform-guard';
import { staticScan, smokeTest, type SmokeCase } from '$lib/selfimprove/verify';

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
      const refusal = await refuseDestructiveCall(name, callerName);
      if (refusal) return refusal;
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
    'Create a new tool, capability or integration and run it immediately — the FAST way to add something the platform cannot yet do. Write the handler, call it once here to prove it works, then keep it with `promote_ephemeral_tool`: live in minutes, no build, no pull request, no deploy. Prefer this over `request_change` for anything shaped like "add a tool" or "give yourself the ability to…"; a change request costs 30-60 minutes and is only needed when the work must live in the repo. ' +
    'Handler receives (args, fetch, platform). `platform.call(name, args)` invokes any registered tool, which is how a handler reaches authenticated services without ever seeing a credential — including `node_call` for capabilities that exist as canvas nodes. Return an ArtifactToolData envelope `{ artifact, summary }` for multimedia responses.',
  toolset: 'custom-tools',
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
        // Kept so promotion can re-run the arguments this tool has actually
        // been seen to work on, rather than take the one successful call on
        // trust. Without it there is no smoke case to hold a promotion to.
        callArgs,
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
  callArgs?: Record<string, unknown>;
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
    'Keep a tool authored by `author_ephemeral_tool`, making it a permanent, reusable capability available in every future conversation — no build, no deploy, no restart. Use it as soon as a one-shot tool proves useful; this is how the platform adds capabilities to itself. The handler is re-checked and re-run against the arguments it was proved on before it is stored, so a tool that cannot repeat itself is refused.',
  toolset: 'custom-tools',
  category: 'Visualise',
  parameters: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'orchestrator_chats.id of the assistant message where the ephemeral ran.' },
      toolCallId: { type: 'string', description: 'The step id (or tool name if id absent) within that message\'s toolSteps.' },
      name: { type: 'string', description: 'Override name. Defaults to sidecar.proposedName.' },
      description: { type: 'string', description: 'Override description. Defaults to sidecar.proposedDescription.' },
      toolset: { type: 'string', description: 'Optional toolset. Defaults to "custom-tools".' },
      smokeCases: {
        type: 'array',
        items: { type: 'object' },
        description:
          'Optional extra argument sets to verify against, beyond the run being promoted. EVERY case must ' +
          'succeed or the promotion is refused. Supply 1-2 covering the edges you care about — this is the ' +
          'only check standing between the handler and the live registry.',
      },
    },
    required: ['messageId', 'toolCallId'],
  },
  handler: (args) => handlePromoteEphemeralTool(args),
});

/**
 * Exported so the gate can be tested directly. Registration above is a thin
 * wrapper; everything that decides whether code reaches the registry is here.
 */
export async function handlePromoteEphemeralTool(args: Record<string, unknown>): Promise<ToolResult> {
    const messageId = args.messageId as string;
    const toolCallId = args.toolCallId as string;
    const nameOverride = args.name as string | undefined;
    const descOverride = args.description as string | undefined;
    const toolsetName = (args.toolset as string | undefined) ?? 'custom-tools';

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

    // ---- The gate ----------------------------------------------------------
    //
    // Promotion writes LLM-authored JavaScript into the registry, enabled, live,
    // and persistent across restarts. Until 2026-08-11 it did that with no
    // checks at all, while the unattended nightly toolsmith — which authors the
    // same kind of code with no human anywhere near it — had to clear
    // staticScan AND a multi-case smoke test first.
    //
    // That asymmetry was the wrong way round. The interactive path is the one
    // reachable from text the model did not write: an email it summarised, a
    // page it scraped, a search result it read. CLAUDE.md calls staticScan
    // "the only thing between an LLM-authored string and the environment"; it
    // simply was not on this road. One standard now, deliberately the stricter
    // one.
    const scan = staticScan(sidecar.handlerCode);
    if (!scan.ok) {
      return {
        success: false,
        error:
          `Refusing to promote "${finalName}" — the handler uses constructs that are never allowed ` +
          `in a stored tool: ${scan.violations.join('; ')}. Rewrite it using fetch and platform.call only.`,
      };
    }

    // The arguments it has actually been seen to work on, plus anything the
    // caller wants to pin. Every case must pass, as it must for the nightly.
    const extraCases = Array.isArray(args.smokeCases)
      ? (args.smokeCases as unknown[]).filter(
          (c): c is Record<string, unknown> => !!c && typeof c === 'object' && !Array.isArray(c),
        )
      : [];
    const cases: SmokeCase[] = [
      ...(sidecar.callArgs ? [{ args: sidecar.callArgs, label: 'the run that was promoted' }] : []),
      ...extraCases.map((c, i) => ({ args: c, label: `supplied case ${i + 1}` })),
    ];
    if (cases.length === 0) {
      return {
        success: false,
        error:
          `Refusing to promote "${finalName}" — no arguments to verify it with. This tool ran before ` +
          `callArgs were recorded on the sidecar; re-run it with author_ephemeral_tool, or pass ` +
          `\`smokeCases\` (2-3 sets of real arguments) to promote it directly.`,
      };
    }

    const platformForSmoke = await buildEphemeralPlatform(finalName);
    const smoke = await smokeTest(cases, async (caseArgs) => {
      try {
        return await compileHandler(sidecar.handlerCode)(caseArgs, globalThis.fetch, platformForSmoke);
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
    if (!smoke.ok) {
      return {
        success: false,
        error:
          `Refusing to promote "${finalName}" — it did not survive re-running its own arguments: ` +
          `${smoke.failureSummary ?? 'a smoke case failed'}. A tool that cannot repeat itself once is ` +
          `not one to leave in the registry.`,
      };
    }
    // ---- end gate ----------------------------------------------------------

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
}
