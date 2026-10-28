import { currentExecution, withExecution } from '$lib/jkai/grounding/execution';
import { retainEvidence } from '$lib/jkai/grounding/evidence.server';
import { dropEmptyOptionalArguments, validateArguments } from '$lib/jkai/grounding/schema';
// Tool Registry — Slim Coordinator
// Types and register() live in registry-internal.ts to avoid circular init with domain modules.

export { register } from './registry-internal';
export type { ToolDefinition, ToolResult } from './registry-internal';
import { ownerPhone } from '$lib/config/owner';
import { tools, getToolsByToolset, getAvailableToolsets, isRegisteredTool } from './registry-internal';
import type { ToolResult } from './registry-internal';
import { normalisePrincipal, principalRefusal, tierOf } from './invoke-contract';
import { isCustomTool } from './custom-tools-enabled';
import { fallbackPrincipal } from './in-process-principal';
import { toolsetBlurb } from '$lib/capabilities/manifest';

const unlabelledSeen = new Set<string>();
/** Once per tool per process: which callers still run without a principal. */
function warnUnlabelled(name: string): void {
  if (unlabelledSeen.has(name) || unlabelledSeen.size > 500) return;
  unlabelledSeen.add(name);
  console.warn(`[principal] ${name} called in-process with no principal; treated as unattended service`);
}

// --- Load all domain modules (each calls register() on import) ---
import './tools/evidence';
import './tools/health';
import './tools/activity';
import './tools/blog';
import './tools/builds';
import './tools/studio';
import './tools/research';
import './tools/whatsapp';
import './tools/workflows';
import './tools/diagnostics';
import './tools/capabilities';
import './tools/memory';
import './tools/followup';
import './tools/heartbeat';
import './tools/scheduled';
import './tools/home-assistant';
import './tools/alexa';
import './tools/visualise';
import './tools/desk';
import './tools/ephemeral-tools';
import './tools/media-write-document';
import './tools/publish-page';
import './tools/develop';
import './tools/media-generate-image';
import './tools/media-generate-audio-tts';
import './tools/file-share';
import './tools/files';
import './tools/route-export';
import './tools/route-plan';
import './tools/knowledge';
import './tools/intel-graph';
import './tools/mail';
import './tools/codegraph';
import './tools/discovery';
import './tools/recall';
import './tools/browser';
import './tools/monitors';
import './tools/gmail';
import './tools/apple-calendar';
import './tools/node-call';
import './tools/custom-tool-admin';
import './tools/web';
import './tools/news';
import './tools/briefing';
import './tools/datastore';
import './tools/apis';
import './tools/api-integrations';
import './tools/request-credential';
import './tools/update-credential';

// --- Public API ---

export function getTools() {
  return tools as readonly (typeof tools)[number][];
}

/** Look up a single registered tool by name. */
export function getTool(name: string) {
  return tools.find((t) => t.name === name);
}

/** Get OpenAI-format tool definitions for ALL registered tools (used by workflow engine, not general chat) */
export function getToolDefinitions() {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/** Get OpenAI-format tool definitions for a specific toolset */
export function getToolsetDefinitions(toolset: string) {
  return getToolsByToolset(toolset).map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * OpenAI-format definitions for specific tools, by name.
 *
 * For pushing an individual capability into the always-on set without dragging
 * its whole toolset along: `research_web_search` lives in `research`, which
 * also carries nine session-management tools nobody wants on every turn.
 *
 * Silently skips a name that is not registered — the caller is a prompt-assembly
 * path and must not fail a turn because a tool was renamed.
 */
export function getToolDefinitionsByName(names: readonly string[]) {
  return names
    .map((n) => tools.find((t) => t.name === n))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}

/** Compact manifest of all toolsets — category, tool names, and one-line descriptions */
export function getToolsetManifest(): Array<{
  toolset: string;
  description: string;
  tools: Array<{ name: string; description: string }>;
}> {
  // The one-line descriptions are the capability manifest's blurbs
  // (`$lib/capabilities/entries`), not a hand-kept map here: a toolset with no
  // row fails `manifest.test.ts` instead of printing its bare name.

  const manifest = getAvailableToolsets().map((ts) => ({
    toolset: ts,
    description: toolsetBlurb(ts) || ts,
    tools: getToolsByToolset(ts).map((t) => ({
      name: t.name,
      description: t.description,
    })),
  }));

  return manifest;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx?: import('./registry-internal').ToolExecContext,
): Promise<ToolResult> {
  ctx = ctx ?? currentExecution();
  // Fail closed for a member: a non-owner call with no scope at all is a caller
  // that forgot to set one, not a caller entitled to everything. Nested calls
  // (ephemeral and custom tools) inherit both fields through `currentExecution`.
  if (ctx?.principalId && ctx.principalId !== 'owner' && !ctx.allowedTools) return { success: false, error: `Tool ${name} is outside this caller's capability scope` };
  if (ctx?.allowedTools && !ctx.allowedTools.includes(name)) return { success: false, error: `Tool ${name} is outside this caller's capability scope` };
  if (ctx?.signal?.aborted || (ctx?.deadline && Date.now() > ctx.deadline)) return { success: false, error: 'Invocation cancelled or expired' };
  if ((ctx?.depth ?? 0) > 5) return { success: false, error: 'Nested capability depth exceeded' };
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { success: false, error: `Unknown tool: ${name}` };
  // Principal phase 2: the effect tiers, enforced here so every path — the
  // invoke route, heartbeat, daydream, the bridge, MCP — meets one policy.
  // A call with no principal is an unattended service call held to its own
  // list; nested calls inherit the caller's through `currentExecution`.
  const principal = ctx?.principal ?? fallbackPrincipal(ctx);
  if (!ctx?.principal) warnUnlabelled(name);
  // The commission lane also needs the credential that carried the call, which
  // only the invoke route sets; in-process callers never can.
  const refusal = principalRefusal(principal, { name, tier: tierOf(tool) }, { commissionCredential: ctx?.credentialLane === 'commission' });
  if (refusal) return { success: false, error: refusal };
  // Re-enabled custom tools (plan P2-0a) are for the owner in an attended
  // chat only: never WhatsApp, heartbeat, the bridge, a workflow node or any
  // other unattended caller, whatever list it carries.
  if (isCustomTool(tool)) {
    const p = normalisePrincipal(principal);
    if (p.principalId !== 'owner' || !p.attended) {
      return { success: false, error: `${name} is a saved custom tool, which runs only in John's own chat in /jkai or the app, not from a ${p.via} call.` };
    }
  }
  args = dropEmptyOptionalArguments(tool.parameters, args);
  const issues = validateArguments(tool.parameters, args);
  if (issues.length) return { success: false, error: 'invalid_arguments', data: { issues, inputSchema: tool.parameters } };
  let result: ToolResult;
  try {
    result = await withExecution(ctx ?? { emit: () => {} }, () => tool.handler(args, ctx));
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }

  // Attach a durable watcher to anything that spawns a long-running task.
  //
  // This hook used to live in general-chat.ts, which the cutover made
  // dormant — so every `producesLongRunningTask` declaration went inert and
  // the last auto-bound watcher dates from May. The model was told by the tool
  // catalogue that watchers attach themselves, so it stopped registering them;
  // when it did register one by hand it had no task binding and could only
  // guess at progress. Hooking the shared execution boundary instead of one
  // engine's loop means both paths get it.
  if (tool.producesLongRunningTask && ctx?.conversationId && result?.success) {
    try {
      const { autoRegisterFromToolResult } = await import('$lib/heartbeat/auto-register');
      const outcome = await autoRegisterFromToolResult({
        conversationId: ctx.conversationId,
        toolName: name,
        produces: tool.producesLongRunningTask,
        resultData: result.data,
      });
      if (!outcome.registered) {
        console.warn(`[heartbeat-auto] skipped ${name}: ${outcome.reason}`);
      }
    } catch (err) {
      // A watcher is a nicety; never fail the tool call over it.
      console.error(`[heartbeat-auto] failed for ${name}:`, err);
    }
  }

  return retainEvidence(name, result, ctx);
}

/** Compact system prompt section — lists toolsets, not individual tools */
export function buildSystemPromptSection(): string {
  const toolsets = getAvailableToolsets();
  // The owner's WhatsApp number used to be appended here as a literal, which
  // put it in the repo, in every commit, and in the prompt sent to a model on
  // every single turn. It is read from the environment now, and only mentioned
  // at all when something is configured to receive it.
  const phone = ownerPhone();
  const contact = phone ? `\n\nJohn's WhatsApp number: ${phone}` : '';
  return `\n\n--- Capabilities ---\nYou have toolsets available: ${toolsets.join(', ')}.\nUse activate_toolset(name) to load tools for a domain. Use jkai_help() to see what's available in each toolset.\nWhen tools are pre-loaded for you, use them directly — no activation needed.${contact}`;
}

// Re-export toolset helpers for use by meta-tools and general-chat
export { getToolsByToolset, getAvailableToolsets, isRegisteredTool };
